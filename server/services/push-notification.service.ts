import webPush, { type PushSubscription as WebPushSubscription } from "web-push";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { PushSubscription } from "@server/database/entities/push-subscription.entity";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("push-notifications");

/** What the dashboard's service worker (dashboard/public/sw.js) receives. */
export interface PushPayload {
  kind: "conversation_needs_attention" | "channel_delivery_failed" | "test";
  title: string;
  body: string;
  /** Path on the dashboard origin the notification opens, e.g. /conversations/<id>. */
  url: string;
  /** Collapses repeated notifications about the same conversation. */
  tag: string;
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/** Notification copy by organization locale (falls back to en). */
const COPY = {
  en: {
    title: "A customer needs a human",
    untitled: "New conversation",
    summaryPending: "Tap to open the conversation and take over.",
    testTitle: "Hay alerts are on",
    testBody: "You will be notified here when a conversation needs a human.",
    deliveryFailedTitle: "A reply could not be delivered",
    deliveryFailedBody: "Hay.chat retried 3 times and gave up. Open the conversation to follow up.",
  },
  "pt-BR": {
    title: "Um cliente precisa de um humano",
    untitled: "Nova conversa",
    summaryPending: "Toque para abrir a conversa e assumir.",
    testTitle: "Alertas do Hay ativados",
    testBody: "Você será avisado aqui quando uma conversa precisar de um humano.",
    deliveryFailedTitle: "Uma resposta não pôde ser entregue",
    deliveryFailedBody:
      "O Hay.chat tentou mais 3 vezes e desistiu. Abra a conversa para acompanhar.",
  },
} as const;

async function copyFor(organizationId: string): Promise<(typeof COPY)[keyof typeof COPY]> {
  const { getOrganizationLocale } = await import("./email.service");
  const locale = await getOrganizationLocale(organizationId);
  return COPY[locale as keyof typeof COPY] ?? COPY.en;
}

/** Endpoint is gone (expired/unsubscribed): the row must be deleted. */
const GONE_STATUS_CODES = new Set([404, 410]);

class PushNotificationService {
  private vapidApplied = false;

  isConfigured(): boolean {
    const { vapidPublicKey, vapidPrivateKey, vapidSubject } = config.push;
    return Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
  }

  /** Public VAPID key for `PushManager.subscribe`, or null when push is off. */
  getPublicKey(): string | null {
    return this.isConfigured() ? config.push.vapidPublicKey : null;
  }

  private repo() {
    return AppDataSource.getRepository(PushSubscription);
  }

  private ensureVapid() {
    if (this.vapidApplied) return;
    webPush.setVapidDetails(
      config.push.vapidSubject,
      config.push.vapidPublicKey,
      config.push.vapidPrivateKey,
    );
    this.vapidApplied = true;
  }

  /**
   * Register (or re-point) a device. The endpoint is unique per browser
   * profile, so re-subscribing from the same device under another user or
   * organization moves the row instead of duplicating it.
   */
  async subscribe(userId: string, organizationId: string, input: SubscribeInput): Promise<void> {
    await this.repo().upsert(
      {
        endpoint: input.endpoint,
        user_id: userId,
        organization_id: organizationId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        user_agent: input.userAgent ? input.userAgent.slice(0, 255) : null,
      },
      ["endpoint"],
    );
  }

  /** Remove a device. Scoped to the caller so one user cannot drop another's. */
  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const result = await this.repo().delete({ endpoint, user_id: userId });
    return (result.affected ?? 0) > 0;
  }

  /** A member who left must stop receiving the organization's alerts. */
  async removeForMember(userId: string, organizationId: string): Promise<void> {
    await this.repo().delete({ user_id: userId, organization_id: organizationId });
  }

  /** Called by the conversation repository on a status transition; only pending-human alerts. */
  async onConversationStatusChanged(conversation: Conversation): Promise<void> {
    if (conversation.status !== "pending-human") return;
    if (!this.isConfigured()) return;

    const copy = await copyFor(conversation.organization_id);

    const who = conversation.customer?.name || conversation.title || copy.untitled;
    const body = conversation.summary
      ? `${who}: ${conversation.summary}`
      : `${who}. ${copy.summaryPending}`;

    await this.sendToOrganization(conversation.organization_id, {
      kind: "conversation_needs_attention",
      title: copy.title,
      body,
      url: `/conversations/${conversation.id}`,
      tag: `conversation:${conversation.id}`,
    });
  }

  /**
   * A reply to a shopper failed on an external channel after every retry
   * (channel-delivery.service). Owners and admins only.
   */
  async onChannelDeliveryFailed(args: {
    organizationId: string;
    conversationId: string;
  }): Promise<void> {
    if (!this.isConfigured()) return;
    const copy = await copyFor(args.organizationId);
    await this.sendToOrganization(
      args.organizationId,
      {
        kind: "channel_delivery_failed",
        title: copy.deliveryFailedTitle,
        body: copy.deliveryFailedBody,
        url: `/conversations/${args.conversationId}`,
        tag: `delivery-failed:${args.conversationId}`,
      },
      { roles: ["owner", "admin"] },
    );
  }

  /**
   * Fan out to every opted-in device of the organization's active members
   * (optionally only members with one of `roles`).
   * Devices of users who lost access keep their row until the next delivery
   * attempt prunes them; the membership join keeps them silent meanwhile.
   */
  async sendToOrganization(
    organizationId: string,
    payload: PushPayload,
    options: { roles?: string[] } = {},
  ): Promise<{ sent: number; removed: number }> {
    const query = this.repo()
      .createQueryBuilder("s")
      .innerJoin(
        "user_organizations",
        "uo",
        "uo.user_id = s.user_id AND uo.organization_id = s.organization_id AND uo.is_active = true",
      )
      .where("s.organization_id = :organizationId", { organizationId });
    if (options.roles?.length) {
      query.andWhere("uo.role IN (:...roles)", { roles: options.roles });
    }
    const subscriptions = await query.getMany();
    return this.deliver(subscriptions, payload);
  }

  /** The "send a test" button: the caller's own devices only. */
  async sendTest(
    userId: string,
    organizationId: string,
  ): Promise<{ sent: number; removed: number }> {
    const copy = await copyFor(organizationId);
    const subscriptions = await this.repo().find({ where: { user_id: userId } });
    return this.deliver(subscriptions, {
      kind: "test",
      title: copy.testTitle,
      body: copy.testBody,
      url: "/",
      tag: "test",
    });
  }

  private async deliver(
    subscriptions: PushSubscription[],
    payload: PushPayload,
  ): Promise<{ sent: number; removed: number }> {
    if (!this.isConfigured() || subscriptions.length === 0) {
      return { sent: 0, removed: 0 };
    }
    this.ensureVapid();

    const body = JSON.stringify(payload);
    let sent = 0;
    let removed = 0;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        const target: WebPushSubscription = {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        };
        try {
          await webPush.sendNotification(target, body, { TTL: 60 * 60, urgency: "high" });
          sent++;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode && GONE_STATUS_CODES.has(statusCode)) {
            await this.repo().delete({ id: subscription.id });
            removed++;
            logger.info(
              { subscriptionId: subscription.id, statusCode },
              "Removed dead push subscription",
            );
          } else {
            logger.warn({ err: error, subscriptionId: subscription.id }, "Push delivery failed");
          }
        }
      }),
    );

    logger.debug({ sent, removed, kind: payload.kind }, "Push fan-out finished");
    return { sent, removed };
  }
}

export const pushNotificationService = new PushNotificationService();

import { timingSafeEqual } from "crypto";
import webPush, { type PushSubscription as WebPushSubscription } from "web-push";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { PushSubscription } from "@server/database/entities/push-subscription.entity";
import { createLogger } from "@server/lib/logger";
import {
  groupByNotificationLocale,
  organizationNotificationLocale,
  userNotificationLocale,
  type NotificationLocale,
} from "./notification-locale";
import { orgDashboardPath } from "@server/lib/dashboard-links";

const logger = createLogger("push-notifications");

/** What the dashboard's service worker (dashboard/public/sw.js) receives. */
export interface PushPayload {
  kind:
    | "conversation_needs_attention"
    | "channel_delivery_failed"
    | "channel_failing"
    | "dispute_opened"
    | "team_question"
    | "test";
  title: string;
  body: string;
  /** Path on the dashboard origin the notification opens, e.g. /<orgId>/conversations/<id>. */
  url: string;
  /** Collapses repeated notifications about the same conversation. */
  tag: string;
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/** Title and body of a push in one locale. */
export type PushCopy = (locale: NotificationLocale) => { title: string; body: string };

/** Test-alert copy by notification locale. */
const TEST_COPY: Record<NotificationLocale, { title: string; body: string }> = {
  en: {
    title: "Hay.chat alerts are on",
    body: "You will be notified here when a conversation needs a human.",
  },
  "pt-BR": {
    title: "Alertas do Hay.chat ativados",
    body: "Você será avisado aqui quando uma conversa precisar de um humano.",
  },
  es: {
    title: "Las alertas de Hay.chat están activadas",
    body: "Te avisaremos aquí cuando una conversación necesite a una persona.",
  },
  nl: {
    title: "Hay.chat-meldingen staan aan",
    body: "Je krijgt hier een melding als een gesprek een mens nodig heeft.",
  },
};

/** "A reply could not be delivered" copy by notification locale. */
const DELIVERY_FAILED_COPY: Record<NotificationLocale, { title: string; body: string }> = {
  en: {
    title: "A reply could not be delivered",
    body: "Hay.chat retried 3 times and gave up. Open the conversation to follow up.",
  },
  "pt-BR": {
    title: "Uma resposta não pôde ser entregue",
    body: "O Hay.chat tentou mais 3 vezes e desistiu. Abra a conversa para acompanhar.",
  },
  es: {
    title: "No se pudo entregar una respuesta",
    body: "Hay.chat lo intentó 3 veces sin éxito. Abre la conversación para darle seguimiento.",
  },
  nl: {
    title: "Een antwoord kon niet worden afgeleverd",
    body: "Hay.chat heeft het 3 keer geprobeerd en is gestopt. Open het gesprek om het op te volgen.",
  },
};

/** Per-recipient result of a push: how many devices accepted it. */
export interface PushResult {
  devices: number;
  sent: number;
  removed: number;
}

/** Endpoint is gone (expired/unsubscribed): the row must be deleted. */
const GONE_STATUS_CODES = new Set([404, 410]);

/** Constant-time comparison of two secrets (no early exit on the first mismatch). */
function sameSecret(stored: string, given: string): boolean {
  const a = Buffer.from(stored || "");
  const b = Buffer.from(given || "");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

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
   * profile, so re-subscribing from the same device under another user moves
   * the row instead of duplicating it. Idempotent: the dashboard calls it on
   * every app open.
   */
  async subscribe(userId: string, input: SubscribeInput): Promise<void> {
    await this.repo().upsert(
      {
        endpoint: input.endpoint,
        user_id: userId,
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

  /**
   * The browser rotated a subscription (`pushsubscriptionchange` in sw.js).
   * The service worker has no access token, so the proof is the old
   * subscription's `auth` secret: only the device and this server hold it (the
   * endpoint alone is not enough, the push service and its logs see it).
   * Returns false when the old endpoint is unknown or the secret does not match.
   */
  async rotate(oldEndpoint: string, oldAuth: string, input: SubscribeInput): Promise<boolean> {
    const existing = await this.repo().findOne({ where: { endpoint: oldEndpoint } });
    if (!existing || !sameSecret(existing.auth, oldAuth)) return false;
    if (oldEndpoint !== input.endpoint) {
      // The new endpoint may already be registered (the app re-synced first)
      await this.repo().delete({ endpoint: input.endpoint });
    }
    await this.repo().update(
      { id: existing.id },
      { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
    );
    return true;
  }

  /** Push to every device of one user. */
  async sendToUser(userId: string, payload: PushPayload): Promise<PushResult> {
    const subscriptions = await this.repo().find({ where: { user_id: userId } });
    const { sent, removed } = await this.deliver(subscriptions, payload);
    return { devices: subscriptions.length, sent, removed };
  }

  /**
   * A reply to a shopper failed on an external channel after every retry
   * (channel-delivery.service). Active owners and admins only.
   */
  async onChannelDeliveryFailed(args: {
    organizationId: string;
    conversationId: string;
  }): Promise<void> {
    await this.toOwnersAndAdmins(args.organizationId, (locale) => DELIVERY_FAILED_COPY[locale], {
      kind: "channel_delivery_failed",
      url: orgDashboardPath(args.organizationId, `/conversations/${args.conversationId}`),
      tag: `delivery-failed:${args.conversationId}`,
    });
  }

  /**
   * A channel is failing (channel-health.service, D13-11): every active owner
   * and admin, each in their own language.
   */
  async onChannelFailing(args: {
    organizationId: string;
    copy: PushCopy;
    url: string;
    tag: string;
  }): Promise<void> {
    await this.toOwnersAndAdmins(args.organizationId, args.copy, {
      kind: "channel_failing",
      url: args.url,
      tag: args.tag,
    });
  }

  /**
   * A payment dispute needs a response (disputes.service, D2-7/D2-8): every
   * active owner and admin, each in their own language.
   */
  async onDisputeOpened(args: {
    organizationId: string;
    copy: PushCopy;
    url: string;
    tag: string;
  }): Promise<void> {
    await this.toOwnersAndAdmins(args.organizationId, args.copy, {
      kind: "dispute_opened",
      url: args.url,
      tag: args.tag,
    });
  }

  /**
   * Every device of the organization's active owners and admins, in each
   * person's interface language (the organization's when they have none).
   */
  private async toOwnersAndAdmins(
    organizationId: string,
    copy: PushCopy,
    payload: Omit<PushPayload, "title" | "body">,
  ): Promise<void> {
    if (!this.isConfigured()) return;
    const subscriptions = await this.repo()
      .createQueryBuilder("s")
      .innerJoin(
        "user_organizations",
        "uo",
        "uo.user_id = s.user_id AND uo.organization_id = :organizationId AND uo.is_active = true AND uo.role IN (:...roles)",
        { organizationId, roles: ["owner", "admin"] },
      )
      .leftJoin("s.user", "u")
      .addSelect(["u.id", "u.interfaceLanguage"])
      .getMany();
    if (subscriptions.length === 0) return;

    const groups = groupByNotificationLocale(
      subscriptions,
      (subscription) => subscription.user?.interfaceLanguage,
      await organizationNotificationLocale(organizationId),
    );
    await Promise.all(
      [...groups].map(([locale, group]) => this.deliver(group, { ...payload, ...copy(locale) })),
    );
  }

  /** The "send a test" button: the caller's own devices only, in their language. */
  async sendTest(
    user: { id: string; interfaceLanguage?: string | null },
    organizationId: string,
  ): Promise<{ sent: number; removed: number }> {
    const copy = TEST_COPY[await userNotificationLocale(user.interfaceLanguage, organizationId)];
    const subscriptions = await this.repo().find({ where: { user_id: user.id } });
    return this.deliver(subscriptions, {
      kind: "test",
      title: copy.title,
      body: copy.body,
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

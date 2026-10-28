import webPush, { type PushSubscription as WebPushSubscription } from "web-push";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { PushSubscription } from "@server/database/entities/push-subscription.entity";
import { createLogger } from "@server/lib/logger";
import { organizationNotificationLocale } from "./notification-locale";

const logger = createLogger("push-notifications");

/** What the dashboard's service worker (dashboard/public/sw.js) receives. */
export interface PushPayload {
  kind: "conversation_needs_attention" | "channel_delivery_failed" | "test";
  title: string;
  body: string;
  /** Path on the dashboard origin the notification opens, e.g. /conversations/<id>?org=<orgId>. */
  url: string;
  /** Collapses repeated notifications about the same conversation. */
  tag: string;
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/** Test-alert copy by organization notification locale. */
const TEST_COPY = {
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
} as const;

/** "A reply could not be delivered" copy by organization notification locale. */
const DELIVERY_FAILED_COPY = {
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
    body: "Hay.chat lo intentó 3 veces y se rindió. Abre la conversación para dar seguimiento.",
  },
} as const;

/** Per-recipient result of a push: how many devices accepted it. */
export interface PushResult {
  devices: number;
  sent: number;
  removed: number;
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
   * The service worker has no access token, so the old endpoint, an
   * unguessable capability URL only the device and the server know, is the
   * proof. Returns false when the old endpoint is unknown.
   */
  async rotate(oldEndpoint: string, input: SubscribeInput): Promise<boolean> {
    const existing = await this.repo().findOne({ where: { endpoint: oldEndpoint } });
    if (!existing) return false;
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
    if (!this.isConfigured()) return;
    const copy = DELIVERY_FAILED_COPY[await organizationNotificationLocale(args.organizationId)];
    const subscriptions = await this.repo()
      .createQueryBuilder("s")
      .innerJoin(
        "user_organizations",
        "uo",
        "uo.user_id = s.user_id AND uo.organization_id = :organizationId AND uo.is_active = true AND uo.role IN (:...roles)",
        { organizationId: args.organizationId, roles: ["owner", "admin"] },
      )
      .getMany();
    await this.deliver(subscriptions, {
      kind: "channel_delivery_failed",
      title: copy.title,
      body: copy.body,
      url: `/conversations/${args.conversationId}?org=${args.organizationId}`,
      tag: `delivery-failed:${args.conversationId}`,
    });
  }

  /** The "send a test" button: the caller's own devices only. */
  async sendTest(
    userId: string,
    organizationId: string,
  ): Promise<{ sent: number; removed: number }> {
    const copy = TEST_COPY[await organizationNotificationLocale(organizationId)];
    const subscriptions = await this.repo().find({ where: { user_id: userId } });
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

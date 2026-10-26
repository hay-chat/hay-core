import webPush, { type PushSubscription as WebPushSubscription } from "web-push";
import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { PushSubscription } from "@server/database/entities/push-subscription.entity";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("push-notifications");

/** What the dashboard's service worker (dashboard/public/sw.js) receives. */
export interface PushPayload {
  kind: "conversation_needs_attention" | "test";
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

/** Copy for the "needs a human" alert, by organization locale (falls back to en). */
const ATTENTION_COPY: Record<string, { title: string; untitled: string; summaryPending: string }> = {
  en: {
    title: "A customer needs a human",
    untitled: "New conversation",
    summaryPending: "Tap to open the conversation and take over.",
  },
  "pt-BR": {
    title: "Um cliente precisa de um humano",
    untitled: "Nova conversa",
    summaryPending: "Toque para abrir a conversa e assumir.",
  },
};

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
  async subscribe(
    userId: string,
    organizationId: string,
    input: SubscribeInput,
  ): Promise<PushSubscription> {
    const repo = this.repo();
    const existing = await repo.findOne({ where: { endpoint: input.endpoint } });
    const row = existing ?? repo.create({ endpoint: input.endpoint });
    row.user_id = userId;
    row.organization_id = organizationId;
    row.p256dh = input.keys.p256dh;
    row.auth = input.keys.auth;
    row.user_agent = input.userAgent ? input.userAgent.slice(0, 255) : null;
    return repo.save(row);
  }

  /** Remove a device. Scoped to the caller so one user cannot drop another's. */
  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const result = await this.repo().delete({ endpoint, user_id: userId });
    return (result.affected ?? 0) > 0;
  }

  async listForUser(userId: string): Promise<PushSubscription[]> {
    return this.repo().find({ where: { user_id: userId }, order: { created_at: "ASC" } });
  }

  /** Called by conversation-events on every status change; only pending-human alerts. */
  async onConversationStatusChanged(conversation: Conversation): Promise<void> {
    if (conversation.status !== "pending-human") return;
    if (!this.isConfigured()) return;

    const { getOrganizationLocale } = await import("./email.service");
    const locale = await getOrganizationLocale(conversation.organization_id);
    const copy = ATTENTION_COPY[locale] ?? ATTENTION_COPY.en;

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

  /** Fan out to every opted-in device of the organization. Never throws. */
  async sendToOrganization(
    organizationId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; removed: number }> {
    const subscriptions = await this.repo().find({ where: { organization_id: organizationId } });
    return this.deliver(subscriptions, payload);
  }

  /** Fan out to one user's devices (used by the "send a test" button). */
  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
    const subscriptions = await this.listForUser(userId);
    return this.deliver(subscriptions, payload);
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
            logger.info({ subscriptionId: subscription.id, statusCode }, "Removed dead push subscription");
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

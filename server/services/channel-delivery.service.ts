/**
 * Channel Delivery Service
 *
 * Subscribes to Redis "websocket:events" channel and delivers outbound
 * bot/agent messages to external channel plugins (WhatsApp, Chatwoot, etc.).
 *
 * Two responsibilities:
 *   1. message_received events → POST to plugin /deliver for outbound send
 *   2. conversation_status_changed → pending-human → POST to plugin /escalate
 *      for channel-side handoff (e.g. Chatwoot toggle_status + assign team)
 *
 * Web channel is skipped for both (dashboard handles it directly).
 * /escalate is best-effort — plugins that don't implement it return 404 which
 * is silently tolerated so channel plugins aren't forced to implement it.
 */

import { createLogger } from "@server/lib/logger";
import { pluginManagerService } from "./plugin-manager.service";
import { MessageRepository } from "@server/repositories/message.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import {
  DELIVERY_SIGNED_URL_TTL_SECONDS,
  HANDOFF_SIGNED_URL_TTL_SECONDS,
  signAttachmentUrls,
} from "./media-url.service";
import { aiDisclosureLine } from "./ai-disclosure";
import { resolveChannelAiMode } from "@server/types/organization-settings.types";
import {
  renderForChannel,
  renderProductList,
  type RecommendedProductLike,
} from "@server/lib/channel-rendering";
import type { Conversation } from "@server/database/entities/conversation.entity";
import {
  MessageType,
  type Message,
  type MessageAttachment,
  type MessageProviderError,
} from "@server/database/entities/message.entity";
import { toPublicAttachments, type PublicAttachment } from "./webchat/public-message";
import { isSimulationConversation } from "./simulation/simulation-kind";

const logger = createLogger("channel-delivery");

/** Most files listed in a handoff (the latest ones the customer sent). */
const HANDOFF_MAX_ATTACHMENTS = 20;
const messageRepository = new MessageRepository();
const conversationRepository = new ConversationRepository();

/**
 * Payload carried by Redis "websocket:events" messages.
 * Untrusted, so every field is optional and narrowed before use.
 */
interface ChannelEventPayload {
  type?: string;
  id?: string;
  content?: string;
  status?: string;
  deliveryState?: string;
  metadata?: { externalOrigin?: boolean; [key: string]: unknown } | null;
  attachments?: MessageAttachment[] | null;
  [key: string]: unknown;
}

/**
 * Event broadcast over the Redis "websocket:events" channel that this
 * service consumes (message delivery + escalation).
 */
interface ChannelDeliveryEvent {
  type?: string;
  conversationId?: string;
  payload?: ChannelEventPayload;
}

/**
 * Response returned by a channel plugin's /deliver endpoint.
 */
interface PluginDeliverResponse {
  success?: boolean;
  providerMessageId?: string;
  error?: string;
}

/** Worker answers meaning "nothing was sent, try again later" (the /deliver contract). */
const RETRYABLE_WORKER_STATUSES = new Set([429, 503]);

/** 3 retries with exponential backoff (5 s, 15 s, 45 s). Meta's pair limit is ~1 msg / 6 s. */
const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

type DeliveryAttemptOutcome =
  | { kind: "delivered"; providerMessageId?: string }
  | { kind: "failed"; retryable: boolean; error: string };

/** `cause.code` of a Node fetch failure (e.g. ECONNREFUSED), if any. */
function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

export class ChannelDeliveryService {
  private initialized = false;
  private readonly retryDelaysMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: { retryDelaysMs?: number[]; sleep?: (ms: number) => Promise<void> } = {}) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Initialize by subscribing to the same Redis channel as the WebSocket service.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { redisService } = await import("./redis.service");

      await redisService.subscribe("websocket:events", (event) => {
        this.handleRedisEvent(event).catch((error) => {
          logger.error({ err: error }, "Unhandled error in channel delivery handler");
        });
      });

      this.initialized = true;
      logger.info("Channel delivery service initialized");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize channel delivery service");
    }
  }

  /**
   * Dispatch Redis events to the right handler.
   */
  private async handleRedisEvent(event: unknown): Promise<void> {
    if (typeof event !== "object" || event === null) return;
    const { type, conversationId } = event as ChannelDeliveryEvent;
    if (!conversationId) return;

    if (type === "message_received") {
      await this.handleOutboundMessage(event);
      return;
    }

    if (type === "conversation_status_changed") {
      await this.handleStatusChange(event);
      return;
    }
  }

  /**
   * Outbound message path — only processes bot/agent messages on non-web channels.
   */
  private async handleOutboundMessage(event: ChannelDeliveryEvent): Promise<void> {
    const { conversationId, payload } = event;
    if (!conversationId || !payload) return;

    // Only deliver bot or human-agent messages and product cards (not customer
    // messages, system, etc.). Cards reach only channels that declare a text
    // rendering for them (D13-12).
    const outboundTypes: string[] = [
      MessageType.BOT_AGENT,
      MessageType.HUMAN_AGENT,
      MessageType.PRODUCT_RECOMMENDATION,
    ];
    if (!payload.type || !outboundTypes.includes(payload.type)) return;
    const isProductCards = payload.type === MessageType.PRODUCT_RECOMMENDATION;

    // Skip messages that originated from the external channel itself — these
    // arrive via the plugin webhook (e.g. a Chatwoot agent replies) and must
    // not be echoed back to the same channel, which would loop indefinitely.
    if (payload?.metadata?.externalOrigin === true) return;

    // Only deliver messages with "sent" delivery state (skip "queued" in test mode)
    if (payload?.deliveryState !== "sent") return;

    try {
      // Look up the conversation to check its channel
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) {
        logger.warn({ conversationId }, "Conversation not found for channel delivery");
        return;
      }
      // Simulated conversations (D7-7) are never delivered.
      if (isSimulationConversation(conversation.metadata)) return;

      // Web channel: the WebSocket service delivers it. A human reply to a
      // shopper who has left goes out by email (D5-9).
      if (conversation.channel === "web") {
        if (payload.type === "HumanAgent") {
          const { emailHumanReplyIfAway } = await import("./web-follow-up.service");
          await emailHumanReplyIfAway(conversation, {
            content: payload.content,
            sender: typeof payload.sender === "string" ? payload.sender : null,
          });
        }
        return;
      }

      const channel = conversation.channel;
      const organizationId = conversation.organization_id;

      // Get the customer's external_id (phone number for WhatsApp, contact id for Chatwoot, etc.)
      // The shopper's identity on this channel: a merged conversation keeps the
      // identity it started with (D13-13), else the customer's external_id.
      const customer = conversation.customer;
      const stampedRecipient = conversation.metadata?.customerExternalId;
      const recipient =
        typeof stampedRecipient === "string" && stampedRecipient
          ? stampedRecipient
          : customer?.external_id;
      if (!recipient) {
        logger.warn({ conversationId, channel }, "No customer external_id for delivery");
        return;
      }

      // Attachment-only messages carry an empty string content and must still
      // be delivered — only a missing id/content aborts.
      const { id: messageId, content } = payload;
      if (!messageId || content === undefined) {
        logger.warn({ conversationId, channel }, "Message id or content missing for delivery");
        return;
      }

      // Product cards are written by the AI outside the reply gate: hold them
      // while the AI's replies on this channel wait for review.
      if (isProductCards && this.aiRepliesHeldForReview(conversation)) return;

      // AI disclosure (D14-7): the first AI reply on a channel opens with the
      // org's AI label, unless the org hid it there (never for EU orgs).
      const disclosure =
        payload.type === "BotAgent" ? this.firstReplyDisclosure(conversation, channel) : null;

      logger.info(
        {
          conversationId,
          channel,
          messageId,
          to: recipient,
          aiDisclosure: !!disclosure,
        },
        "Delivering message via channel plugin",
      );

      await this.deliverViaPlugin({
        organizationId,
        channel,
        to: recipient,
        content: disclosure ? (content ? `${disclosure}\n\n${content}` : disclosure) : content,
        aiDisclosed: !!disclosure,
        messageId,
        messageType: payload.type,
        conversationId,
        conversationMetadata: (conversation.metadata ?? null) as Record<string, unknown> | null,
        language: conversation.language ?? null,
        messageMetadata: (payload.metadata ?? null) as Record<string, unknown> | null,
        attachments: payload.attachments ?? [],
        products: isProductCards ? this.recommendedProducts(payload.metadata) : undefined,
      });
    } catch (error) {
      logger.error({ err: error, conversationId }, "Channel delivery failed");
    }
  }

  /** The products of a ProductRecommendation message (from its metadata). */
  private recommendedProducts(
    metadata: ChannelEventPayload["metadata"] | undefined,
  ): RecommendedProductLike[] {
    const recommendation = metadata?.productRecommendation as { products?: unknown } | undefined;
    return Array.isArray(recommendation?.products)
      ? (recommendation.products as RecommendedProductLike[])
      : [];
  }

  /**
   * True when AI replies on this conversation's channel are queued for a person
   * to approve: test mode (agent, else org default) or a "drafts only" channel.
   * Mirrors the gate in Conversation.addMessage.
   */
  private aiRepliesHeldForReview(conversation: Conversation): boolean {
    const settings = conversation.organization?.settings;
    if (resolveChannelAiMode(settings, conversation.channel) === "drafts") return true;
    const testMode = conversation.agent?.testMode;
    if (testMode !== null && testMode !== undefined) return testMode;
    return settings?.testModeDefault === true;
  }

  /**
   * The AI disclosure line for this reply, or null when the label is hidden on
   * the channel or an earlier AI reply in the conversation already carried it.
   */
  private firstReplyDisclosure(conversation: Conversation, channel: string): string | null {
    const alreadyDisclosed = (conversation.messages ?? []).some(
      (message) => message.metadata?.aiDisclosureSent === true,
    );
    if (alreadyDisclosed) return null;
    return aiDisclosureLine(conversation.organization, channel, conversation.language);
  }

  /** Record that a delivered AI reply carried the disclosure line. Best effort. */
  private async markDisclosed(messageId: string): Promise<void> {
    try {
      const message = await messageRepository.findById(messageId);
      if (!message) return;
      await messageRepository.update(messageId, {
        metadata: { ...(message.metadata ?? {}), aiDisclosureSent: true },
      });
    } catch (err) {
      logger.error({ err, messageId }, "Failed to record the AI disclosure");
    }
  }

  /**
   * Files the customer sent (D8-10), newest last, as signed links the human
   * agent can open from the provider's tool. Private uploads that can't be
   * signed are left out rather than sent as dead links.
   */
  private async handoffAttachments(
    messages: Array<Pick<Message, "type" | "attachments">>,
    organizationId: string,
  ): Promise<PublicAttachment[]> {
    const sent = messages
      .filter((message) => message.type === MessageType.CUSTOMER)
      .flatMap((message) => message.attachments ?? [])
      .slice(-HANDOFF_MAX_ATTACHMENTS);
    if (!sent.length) return [];
    try {
      return await toPublicAttachments(sent, organizationId, HANDOFF_SIGNED_URL_TTL_SECONDS);
    } catch (error) {
      logger.warn({ err: error, organizationId }, "Failed to sign handoff attachments");
      return [];
    }
  }

  /**
   * Escalation path — when the orchestrator flips a conversation to pending-human
   * on a non-web channel, notify the owning plugin so it can perform provider-side
   * handoff (Chatwoot: toggle_status=open + optional assign + private note).
   */
  private async handleStatusChange(event: ChannelDeliveryEvent): Promise<void> {
    const { conversationId, payload } = event;
    if (!conversationId) return;
    if (payload?.status !== "pending-human") return;

    try {
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) return;
      if (conversation.channel === "web") return;
      if (isSimulationConversation(conversation.metadata)) return;

      const pluginId = await pluginManagerService.findPluginIdByChannel(
        conversation.organization_id,
        conversation.channel,
      );
      if (!pluginId) return;

      logger.info(
        { conversationId, channel: conversation.channel, pluginId },
        "Dispatching /escalate to channel plugin",
      );

      let worker;
      try {
        worker = await pluginManagerService.getOrStartWorker(
          conversation.organization_id,
          pluginId,
        );
      } catch (error) {
        logger.error(
          { err: error, pluginId, organizationId: conversation.organization_id },
          "Failed to get/start channel plugin worker for escalation",
        );
        return;
      }

      const escalateUrl = `http://localhost:${worker.port}/escalate`;

      try {
        const response = await fetch(escalateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            conversationMetadata: conversation.metadata ?? null,
            reason: "orchestrator_handoff",
            attachments: await this.handoffAttachments(
              conversation.messages ?? [],
              conversation.organization_id,
            ),
          }),
        });

        // 404 = plugin doesn't implement /escalate — that's fine.
        if (response.status === 404) {
          logger.debug(
            { pluginId, channel: conversation.channel },
            "Channel plugin does not implement /escalate — skipping",
          );
          return;
        }

        if (!response.ok) {
          const text = await response.text();
          logger.warn(
            { pluginId, status: response.status, body: text },
            "Plugin /escalate returned non-OK",
          );
        }
      } catch (error) {
        logger.error(
          { err: error, escalateUrl, conversationId },
          "Failed to call plugin /escalate",
        );
      }
    } catch (error) {
      logger.error({ err: error, conversationId }, "handleStatusChange failed");
    }
  }

  /**
   * Find the appropriate plugin worker for this channel and POST to its /deliver endpoint.
   *
   * Resolves the org's enabled plugin instance whose manifest `channel` field
   * (package.json `hay-plugin.channel`) matches the conversation channel.
   *
   * Retry (D13-7): a transient failure is retried up to `retryDelaysMs.length`
   * times with backoff. Only failures where the provider certainly did not
   * accept the message are retried, so a reply is never sent twice:
   *   - the worker answered 503 or 429 (the /deliver contract: a plugin returns
   *     these only while nothing was accepted; once one part went out it
   *     reports success),
   *   - the worker could not be started or the connection to it was refused.
   * Anything else is final. After the last retry the message keeps
   * `providerStatus: failed` and the org's owners and admins are alerted.
   */
  private async deliverViaPlugin(args: {
    organizationId: string;
    channel: string;
    to: string;
    content: string;
    /** The content opens with the AI disclosure line; recorded once delivered. */
    aiDisclosed?: boolean;
    messageId: string;
    /** Who wrote it (e.g. "HumanAgent"): Meta lets a person reply after 24 h with the Human Agent tag. */
    messageType: string;
    conversationId: string;
    conversationMetadata: Record<string, unknown> | null;
    /** Conversation language (e.g. "pt"), so a plugin can pick a template language. */
    language: string | null;
    messageMetadata: Record<string, unknown> | null;
    attachments: MessageAttachment[];
    /** Set for a ProductRecommendation message: its products, sent as a text list. */
    products?: RecommendedProductLike[];
  }): Promise<void> {
    const { organizationId, channel, messageId, conversationId, attachments } = args;

    const pluginId = await pluginManagerService.findPluginIdByChannel(organizationId, channel);

    if (!pluginId) {
      logger.warn({ channel, organizationId }, "No enabled plugin for channel in organization");
      return;
    }

    // What the channel can show (D13-12): product cards become a text list
    // with links, Markdown is stripped or converted.
    const rendering = pluginManagerService.getChannelRendering(pluginId);
    let content = args.content;
    if (args.products) {
      if (rendering.productRecommendations !== "text") return;
      content = renderProductList(args.products, args.language);
      if (!content) return;
    }
    content = renderForChannel(content, rendering);

    // Private uploads need a signature: the worker fetches each file with a plain GET.
    // Signed once: the TTL outlives every retry.
    const deliverableAttachments = await signAttachmentUrls(
      attachments,
      organizationId,
      DELIVERY_SIGNED_URL_TTL_SECONDS,
    );
    const body = JSON.stringify({
      to: args.to,
      content,
      messageId,
      messageType: args.messageType,
      conversationId,
      conversationMetadata: args.conversationMetadata,
      language: args.language,
      messageMetadata: args.messageMetadata,
      attachments: deliverableAttachments,
    });

    for (let attempt = 0; ; attempt++) {
      const outcome = await this.attemptDelivery({ organizationId, pluginId, body });

      if (outcome.kind === "delivered") {
        if (outcome.providerMessageId) {
          // Store the provider's message id (e.g. Meta wamid, Chatwoot message id)
          // so later status webhooks can be matched back to this message.
          await messageRepository.updateProviderMessageId(messageId, outcome.providerMessageId);
        }
        if (args.aiDisclosed) await this.markDisclosed(messageId);
        const { channelHealthService } = await import("./channel-health.service");
        await channelHealthService.recordDeliverySuccess(organizationId, pluginId);
        logger.info(
          { messageId, providerMessageId: outcome.providerMessageId, channel, attempt },
          "Channel delivery successful",
        );
        return;
      }

      const retriesLeft = attempt < this.retryDelaysMs.length;
      if (outcome.retryable && retriesLeft) {
        const delayMs = this.retryDelaysMs[attempt];
        logger.warn(
          { messageId, channel, error: outcome.error, attempt: attempt + 1, delayMs },
          "Channel delivery failed transiently — retrying",
        );
        await this.sleep(delayMs);
        continue;
      }

      if (outcome.error === "24h_window_expired") {
        logger.warn({ messageId, channel, conversationId }, "24h session window expired");
      } else {
        logger.error(
          { messageId, channel, error: outcome.error, attempts: attempt + 1 },
          "Channel delivery failed",
        );
      }
      const error: MessageProviderError = { code: outcome.error };
      await this.markDeliveryFailed({ messageId, conversationId, organizationId, error });
      const { channelHealthService } = await import("./channel-health.service");
      await channelHealthService.recordDeliveryFailure(organizationId, channel);
      if (outcome.retryable) {
        await this.alertDeliveryFailed({
          organizationId,
          conversationId,
          messageId,
          channel,
          error,
        });
      }
      return;
    }
  }

  /** One POST to the worker's /deliver, classified for the retry loop. */
  private async attemptDelivery(args: {
    organizationId: string;
    pluginId: string;
    body: string;
  }): Promise<DeliveryAttemptOutcome> {
    const { organizationId, pluginId, body } = args;

    let worker;
    try {
      worker = await pluginManagerService.getOrStartWorker(organizationId, pluginId);
    } catch (error) {
      logger.error(
        { err: error, pluginId, organizationId },
        "Failed to get/start channel plugin worker",
      );
      return { kind: "failed", retryable: true, error: "worker_unavailable" };
    }

    const deliverUrl = `http://localhost:${worker.port}/deliver`;
    let response: Response;
    try {
      response = await fetch(deliverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (error) {
      // Refused = the worker never saw the request. Any other network error may
      // have happened after the worker sent the message, so it is not retried.
      const refused = errorCode(error) === "ECONNREFUSED";
      logger.error(
        { err: error, deliverUrl, refused },
        "Failed to deliver message to plugin worker",
      );
      return { kind: "failed", retryable: refused, error: "worker_unreachable" };
    }

    let result: PluginDeliverResponse = {};
    try {
      result = ((await response.json()) ?? {}) as PluginDeliverResponse;
    } catch {
      result = {};
    }

    if (result.success) {
      return { kind: "delivered", providerMessageId: result.providerMessageId };
    }
    return {
      kind: "failed",
      retryable: RETRYABLE_WORKER_STATUSES.has(response.status),
      error: result.error ?? "delivery_failed",
    };
  }

  /**
   * Tell the org's owners and admins a reply could not be delivered after every
   * retry: web push to their devices, and a dashboard event (toast) for anyone
   * who has it open. Best effort.
   */
  private async alertDeliveryFailed(args: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    channel: string;
    error: MessageProviderError;
  }): Promise<void> {
    const { organizationId, conversationId, messageId, channel, error } = args;
    try {
      const { redisService } = await import("./redis.service");
      await redisService.publish("websocket:events", {
        type: "channel_delivery_failed",
        organizationId,
        payload: { conversationId, messageId, channel, providerError: error },
      });
    } catch (err) {
      logger.error({ err, messageId }, "Failed to publish delivery-failure alert");
    }
    try {
      const { pushNotificationService } = await import("./push-notification.service");
      await pushNotificationService.onChannelDeliveryFailed({ organizationId, conversationId });
    } catch (err) {
      logger.error({ err, messageId }, "Failed to push delivery-failure alert");
    }
  }

  /**
   * Persist a provider-side failure on the message and tell dashboard clients.
   * Publishes `message_status_updated` — never `message_received`, which would
   * re-trigger delivery.
   */
  private async markDeliveryFailed(args: {
    messageId: string;
    conversationId: string;
    organizationId: string;
    error: MessageProviderError;
  }): Promise<void> {
    const { messageId, conversationId, organizationId, error } = args;
    try {
      await messageRepository.update(messageId, {
        providerStatus: "failed",
        providerError: error,
      });

      const { redisService } = await import("./redis.service");
      await redisService.publish("websocket:events", {
        type: "message_status_updated",
        organizationId,
        payload: {
          conversationId,
          messageId,
          providerStatus: "failed",
          providerError: error,
        },
      });
    } catch (err) {
      logger.error({ err, messageId }, "Failed to persist delivery failure");
    }
  }
}

export const channelDeliveryService = new ChannelDeliveryService();

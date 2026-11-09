/**
 * Channel Delivery Service
 *
 * Consumes the durable delivery queue and calls external channel plugins
 * (WhatsApp, Chatwoot, etc.). Each delivery has a row in message_deliveries;
 * only the consumer that claims it makes the call, so a message is sent once
 * however many server instances are running.
 *
 * Two kinds of delivery:
 *   1. message → POST to plugin /deliver for outbound send
 *   2. escalation → POST to plugin /escalate for channel-side handoff
 *      (e.g. Chatwoot toggle_status + assign team)
 *
 * Plugins that don't implement /escalate return 404, which counts as done, so
 * channel plugins aren't forced to implement it.
 */

import { createLogger } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { pluginManagerService } from "./plugin-manager.service";
import { MessageRepository } from "@server/repositories/message.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import {
  DELIVERY_SIGNED_URL_TTL_SECONDS,
  HANDOFF_SIGNED_URL_TTL_SECONDS,
  signAttachmentUrls,
} from "./media-url.service";
import { aiDisclosureLine } from "./ai-disclosure";
import { aiRepliesHeldForReview } from "./ai-reply-review";
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
import { workerFetch } from "@server/lib/worker-client";
import type { ConsumeMessage } from "amqplib";
import {
  messageDeliveryRepository,
  type ClaimedDelivery,
} from "@server/repositories/message-delivery.repository";
import { rabbitmqService, type RabbitMQService } from "./rabbitmq.service";
import {
  CHANNEL_DELIVERY_QUEUES,
  ChannelDeliveryQueueService,
  DEFAULT_RETRY_DELAYS_MS,
  channelDeliveryQueueService,
  type ChannelDeliveryQueueMessage,
} from "./channel-delivery-queue.service";

const logger = createLogger("channel-delivery");

/** Most files listed in a handoff (the latest ones the customer sent). */
const HANDOFF_MAX_ATTACHMENTS = 20;
const messageRepository = new MessageRepository();
const conversationRepository = new ConversationRepository();

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

/** Budget for one call to the channel worker (deliver / escalate). */
const WORKER_REQUEST_TIMEOUT_MS = 30_000;

/** Calls running at once per server instance. */
const DELIVERY_PREFETCH = 10;
/** A claim older than this means the server holding it died. */
const STALE_CLAIM_MS = 5 * 60 * 1000;
/** A pending delivery overdue by this long never reached (or fell out of) the queue. */
const SWEEP_GRACE_MS = 30_000;
const SWEEP_BATCH = 100;
/** Deliveries sent per sweep without the queue; each may take a full worker timeout. */
const DIRECT_SWEEP_BATCH = 20;

type DeliveryAttemptOutcome =
  | { kind: "delivered"; providerMessageId?: string }
  | { kind: "failed"; retryable: boolean; error: string };

/** What one claim of a delivery came to. */
type DeliveryAttempt =
  { kind: "delivered" } | { kind: "failed"; retryable: boolean; error: string; channel?: string };

/** done/skipped: ack; retry: on a delay queue; dead: gave up after every retry. */
export type DeliveryResult = "done" | "skipped" | "retry" | "dead";

/** Everything needed to POST a message to its channel plugin. */
interface DeliveryPlan {
  organizationId: string;
  pluginId: string;
  channel: string;
  messageId: string;
  conversationId: string;
  /** The content opens with the AI disclosure line; recorded once delivered. */
  aiDisclosed: boolean;
  body: string;
}

/** `cause.code` of a Node fetch failure (e.g. ECONNREFUSED), if any. */
function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

export class ChannelDeliveryService {
  private initialized = false;
  private consuming = false;
  private inFlight = new Set<Promise<void>>();
  private readonly retryDelaysMs: number[];
  private readonly rabbit: RabbitMQService;
  private readonly queue: ChannelDeliveryQueueService;
  private readonly sweepGraceMs: number;

  constructor(
    options: { retryDelaysMs?: number[]; rabbit?: RabbitMQService; sweepGraceMs?: number } = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.rabbit = options.rabbit ?? rabbitmqService;
    this.queue =
      options.rabbit || options.retryDelaysMs
        ? new ChannelDeliveryQueueService(this.rabbit, this.retryDelaysMs)
        : channelDeliveryQueueService;
    this.sweepGraceMs = options.sweepGraceMs ?? SWEEP_GRACE_MS;
  }

  /**
   * Start consuming, now or whenever RabbitMQ connects. Until then the sweep
   * sends pending deliveries directly.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.rabbit.on("connected", () => {
      this.startConsuming().catch((error) => {
        logger.error({ err: error }, "Failed to start the channel delivery consumer");
      });
    });
    if (this.rabbit.isConnected()) await this.startConsuming();
    logger.info("Channel delivery service initialized");
  }

  private async startConsuming(): Promise<void> {
    await this.queue.declareQueues();
    if (this.consuming) return;
    this.consuming = true;

    await this.rabbit.consume(
      CHANNEL_DELIVERY_QUEUES.DELIVER,
      (msg) => this.track(this.onDeliverMessage(msg)),
      { prefetch: DELIVERY_PREFETCH },
    );
    await this.rabbit.consume(
      CHANNEL_DELIVERY_QUEUES.DEAD,
      (msg) => this.track(this.onDeadMessage(msg)),
      { prefetch: 1 },
    );
  }

  private track(work: Promise<void>): Promise<void> {
    this.inFlight.add(work);
    return work.finally(() => this.inFlight.delete(work));
  }

  /** Stop taking deliveries and wait for the ones in progress (bounded). */
  async stop(timeoutMs: number): Promise<void> {
    await this.rabbit.stopConsuming(CHANNEL_DELIVERY_QUEUES.DELIVER);
    await this.rabbit.stopConsuming(CHANNEL_DELIVERY_QUEUES.DEAD);
    if (this.inFlight.size === 0) return;

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (this.inFlight.size > 0) {
      logger.warn({ count: this.inFlight.size }, "Stopped with deliveries still in progress");
    }
  }

  private async onDeliverMessage(msg: ConsumeMessage): Promise<void> {
    const { messageId } = this.rabbit.parseMessage<ChannelDeliveryQueueMessage>(msg);
    const result = await this.processDelivery(messageId);
    // A nack goes to the dead-letter queue, whose consumer tells the team.
    if (result === "dead") this.rabbit.nack(msg, false);
    else this.rabbit.ack(msg);
  }

  private async onDeadMessage(msg: ConsumeMessage): Promise<void> {
    const { messageId } = this.rabbit.parseMessage<ChannelDeliveryQueueMessage>(msg);
    await this.handleDeadLetter(messageId);
    this.rabbit.ack(msg);
  }

  /**
   * Claim one delivery and make the call. Duplicates of a queue message, from
   * this or another server, find nothing to claim and do nothing.
   *
   * Retry (D13-7): a transient failure is retried up to `retryDelaysMs.length`
   * times with backoff, through delay queues. Only failures where the provider
   * certainly did not accept the message are retried, so a reply is never sent
   * twice:
   *   - the worker answered 503 or 429 (the /deliver contract: a plugin returns
   *     these only while nothing was accepted; once one part went out it
   *     reports success),
   *   - the worker could not be started or the connection to it was refused.
   * Anything else is final. After the last retry the message keeps
   * `providerStatus: failed` and the dead-letter consumer alerts the org's
   * owners and admins.
   */
  async processDelivery(id: string): Promise<DeliveryResult> {
    const delivery = await messageDeliveryRepository.claim(id);
    if (!delivery) return "skipped";

    const attempt =
      delivery.kind === "escalation"
        ? await this.runEscalation(delivery)
        : await this.runMessage(delivery);

    if (attempt.kind === "delivered") {
      await messageDeliveryRepository.markDelivered(id);
      return "done";
    }

    const retryIndex = delivery.attempts - 1;
    if (attempt.retryable && retryIndex < this.retryDelaysMs.length) {
      const delayMs = this.retryDelaysMs[retryIndex];
      logger.warn(
        { id, kind: delivery.kind, error: attempt.error, attempt: delivery.attempts, delayMs },
        "Channel delivery failed transiently — retrying",
      );
      await messageDeliveryRepository.scheduleRetry(id, delayMs, attempt.error);
      await this.queue.publishRetry(id, delayMs);
      return "retry";
    }

    await messageDeliveryRepository.markFailed(id, attempt.error);
    if (delivery.kind === "message") await this.recordMessageFailure(delivery, attempt);
    return attempt.retryable ? "dead" : "done";
  }

  private async recordMessageFailure(
    delivery: ClaimedDelivery,
    attempt: { error: string; channel?: string },
  ): Promise<void> {
    const { id: messageId, organizationId, conversationId, attempts } = delivery;
    const { channel } = attempt;
    if (attempt.error === "24h_window_expired") {
      logger.warn({ messageId, channel, conversationId }, "24h session window expired");
    } else {
      logger.error(
        { messageId, channel, error: attempt.error, attempts },
        "Channel delivery failed",
      );
    }
    await this.markDeliveryFailed({
      messageId,
      conversationId,
      organizationId,
      error: { code: attempt.error },
    });
    if (channel) {
      const { channelHealthService } = await import("./channel-health.service");
      await channelHealthService.recordDeliveryFailure(organizationId, channel);
    }
  }

  /**
   * A delivery that used up its retries: flag the conversation for the team
   * and alert owners and admins. Runs once per delivery.
   */
  async handleDeadLetter(id: string): Promise<void> {
    const delivery = await messageDeliveryRepository.markDead(id);
    if (!delivery) return;
    metrics.deadLetters.inc({ queue: CHANNEL_DELIVERY_QUEUES.DEAD });
    const { conversationId, organizationId, kind, lastError } = delivery;
    logger.error({ id, kind, conversationId, error: lastError }, "Channel delivery dead-lettered");

    await conversationRepository.updateById(conversationId, {
      is_stuck: true,
      stuck_detected_at: new Date(),
      stuck_reason: kind === "message" ? "channel_delivery_failed" : "channel_escalation_failed",
    });

    if (kind !== "message") return;
    const conversation = await conversationRepository.findById(conversationId);
    await this.alertDeliveryFailed({
      organizationId,
      conversationId,
      messageId: id,
      channel: conversation?.channel ?? "unknown",
      error: { code: lastError ?? "delivery_failed" },
    });
  }

  /**
   * Scheduled safety net for what the queue cannot cover: fail claims left by a
   * dead server, publish deliveries the queue never received, and send them
   * directly while RabbitMQ is down.
   */
  async sweep(signal?: AbortSignal): Promise<void> {
    for (const delivery of await messageDeliveryRepository.failStaleClaims(STALE_CLAIM_MS)) {
      if (delivery.kind === "message") {
        await this.markDeliveryFailed({
          messageId: delivery.id,
          conversationId: delivery.conversationId,
          organizationId: delivery.organizationId,
          error: { code: "delivery_interrupted" },
        });
      }
      await this.handleDeadLetter(delivery.id);
    }

    if (this.rabbit.isConnected()) {
      const due = await messageDeliveryRepository.takeDue(this.sweepGraceMs, SWEEP_BATCH);
      for (const id of due) await this.queue.publish(id);
      return;
    }

    const due = await messageDeliveryRepository.takeDue(0, DIRECT_SWEEP_BATCH);
    for (const id of due) {
      if (signal?.aborted) return;
      const result = await this.processDelivery(id);
      if (result === "dead") await this.handleDeadLetter(id);
    }
  }

  /** Prepare and send one message. Nothing has reached the provider if preparing throws. */
  private async runMessage(delivery: ClaimedDelivery): Promise<DeliveryAttempt> {
    let plan: DeliveryPlan | null;
    try {
      plan = await this.prepareMessage(delivery);
    } catch (error) {
      logger.error({ err: error, id: delivery.id }, "Failed to prepare channel delivery");
      return { kind: "failed", retryable: true, error: "delivery_preparation_failed" };
    }
    if (!plan) return { kind: "delivered" };

    const outcome = await this.attemptDelivery(plan);
    if (outcome.kind === "failed") return { ...outcome, channel: plan.channel };

    await this.recordDelivered(plan, outcome.providerMessageId);
    return { kind: "delivered" };
  }

  /** The provider has the message: bookkeeping here must never cause a resend. */
  private async recordDelivered(plan: DeliveryPlan, providerMessageId?: string): Promise<void> {
    const { messageId, organizationId, pluginId, channel } = plan;
    try {
      if (providerMessageId) {
        // Store the provider's message id (e.g. Meta wamid, Chatwoot message id)
        // so later status webhooks can be matched back to this message.
        await messageRepository.updateProviderMessageId(messageId, providerMessageId);
      }
      if (plan.aiDisclosed) await this.markDisclosed(messageId);
      const { channelHealthService } = await import("./channel-health.service");
      await channelHealthService.recordDeliverySuccess(organizationId, pluginId);
      logger.info({ messageId, providerMessageId, channel }, "Channel delivery successful");
    } catch (error) {
      logger.error({ err: error, messageId }, "Delivered, but failed to record it");
    }
  }

  /** Decide whether a queued message goes out, and build the /deliver call. */
  private async prepareMessage(delivery: ClaimedDelivery): Promise<DeliveryPlan | null> {
    const { id: messageId, conversationId } = delivery;

    const message = await messageRepository.findById(messageId);
    if (!message) {
      logger.warn({ messageId, conversationId }, "Message not found for channel delivery");
      return null;
    }
    const isProductCards = message.type === MessageType.PRODUCT_RECOMMENDATION;

    // Look up the conversation to check its channel
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      logger.warn({ conversationId }, "Conversation not found for channel delivery");
      return null;
    }
    // Simulated conversations (D7-7) are never delivered.
    if (isSimulationConversation(conversation.metadata)) return null;

    // Web channel: the WebSocket service delivers it. A human reply to a
    // shopper who has left goes out by email (D5-9).
    if (conversation.channel === "web") {
      if (message.type === MessageType.HUMAN_AGENT) {
        const { emailHumanReplyIfAway } = await import("./web-follow-up.service");
        await emailHumanReplyIfAway(conversation, {
          content: message.content,
          sender: typeof message.sender === "string" ? message.sender : null,
        });
      }
      return null;
    }

    const channel = conversation.channel;

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
      return null;
    }

    // Product cards are written by the AI outside the reply gate: hold them
    // while the AI's replies on this channel wait for review.
    if (isProductCards && aiRepliesHeldForReview(conversation)) return null;

    // AI disclosure (D14-7): the first AI reply on a channel opens with the
    // org's AI label, unless the org hid it there (never for EU orgs).
    const disclosure =
      message.type === MessageType.BOT_AGENT
        ? this.firstReplyDisclosure(conversation, channel)
        : null;

    logger.info(
      { conversationId, channel, messageId, to: recipient, aiDisclosure: !!disclosure },
      "Delivering message via channel plugin",
    );

    // Attachment-only messages carry an empty string content and must still be delivered.
    const content = message.content;
    return this.buildDeliveryPlan({
      organizationId: conversation.organization_id,
      channel,
      to: recipient,
      content: disclosure ? (content ? `${disclosure}\n\n${content}` : disclosure) : content,
      aiDisclosed: !!disclosure,
      messageId,
      messageType: message.type,
      conversationId,
      conversationMetadata: (conversation.metadata ?? null) as Record<string, unknown> | null,
      language: conversation.language ?? null,
      messageMetadata: (message.metadata ?? null) as Record<string, unknown> | null,
      attachments: message.attachments ?? [],
      products: isProductCards ? this.recommendedProducts(message.metadata) : undefined,
    });
  }

  /** The products of a ProductRecommendation message (from its metadata). */
  private recommendedProducts(metadata: Message["metadata"] | undefined): RecommendedProductLike[] {
    const recommendation = (metadata as Record<string, unknown> | null | undefined)
      ?.productRecommendation as { products?: unknown } | undefined;
    return Array.isArray(recommendation?.products)
      ? (recommendation.products as RecommendedProductLike[])
      : [];
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
   * Escalation path — when a conversation goes to pending-human on a non-web
   * channel, notify the owning plugin so it can perform provider-side handoff
   * (Chatwoot: toggle_status=open + optional assign + private note).
   */
  private async runEscalation(delivery: ClaimedDelivery): Promise<DeliveryAttempt> {
    const { conversationId } = delivery;

    let plan: { pluginId: string; port: number; body: string } | null;
    try {
      plan = await this.prepareEscalation(delivery);
    } catch (error) {
      logger.error({ err: error, conversationId }, "Failed to prepare /escalate");
      return { kind: "failed", retryable: true, error: "worker_unavailable" };
    }
    if (!plan) return { kind: "delivered" };

    let response: Response;
    try {
      response = await workerFetch(plan.port, "/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: plan.body,
        signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const refused = errorCode(error) === "ECONNREFUSED";
      logger.error({ err: error, port: plan.port, conversationId }, "Failed to call /escalate");
      return { kind: "failed", retryable: refused, error: "worker_unreachable" };
    }

    // 404 = plugin doesn't implement /escalate — that's fine.
    if (response.status === 404) {
      logger.debug({ pluginId: plan.pluginId }, "Plugin does not implement /escalate — skipping");
      return { kind: "delivered" };
    }

    if (!response.ok) {
      const text = await response.text();
      logger.warn(
        { pluginId: plan.pluginId, status: response.status, body: text },
        "Plugin /escalate returned non-OK",
      );
      return {
        kind: "failed",
        retryable: RETRYABLE_WORKER_STATUSES.has(response.status),
        error: `escalate_http_${response.status}`,
      };
    }
    return { kind: "delivered" };
  }

  private async prepareEscalation(
    delivery: ClaimedDelivery,
  ): Promise<{ pluginId: string; port: number; body: string } | null> {
    const { conversationId, attempts } = delivery;
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) return null;
    if (conversation.channel === "web") return null;
    if (isSimulationConversation(conversation.metadata)) return null;
    // A retry may come after a person has already picked the conversation up.
    if (attempts > 1 && conversation.status !== "pending-human") return null;

    const pluginId = await pluginManagerService.findPluginIdByChannel(
      conversation.organization_id,
      conversation.channel,
    );
    if (!pluginId) return null;

    logger.info(
      { conversationId, channel: conversation.channel, pluginId },
      "Dispatching /escalate to channel plugin",
    );

    const worker = await pluginManagerService.getOrStartWorker(
      conversation.organization_id,
      pluginId,
    );
    return {
      pluginId,
      port: worker.port,
      body: JSON.stringify({
        conversationId,
        conversationMetadata: conversation.metadata ?? null,
        reason: "orchestrator_handoff",
        attachments: await this.handoffAttachments(
          conversation.messages ?? [],
          conversation.organization_id,
        ),
      }),
    };
  }

  /**
   * Resolve the org's enabled plugin instance whose manifest `channel` field
   * (package.json `hay-plugin.channel`) matches the conversation channel, and
   * build its /deliver body. Null when there is nothing to send on this channel.
   */
  private async buildDeliveryPlan(args: {
    organizationId: string;
    channel: string;
    to: string;
    content: string;
    aiDisclosed: boolean;
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
  }): Promise<DeliveryPlan | null> {
    const { organizationId, channel, messageId, conversationId, attachments } = args;

    const pluginId = await pluginManagerService.findPluginIdByChannel(organizationId, channel);

    if (!pluginId) {
      logger.warn({ channel, organizationId }, "No enabled plugin for channel in organization");
      return null;
    }

    // What the channel can show (D13-12): product cards become a text list
    // with links, Markdown is stripped or converted.
    const rendering = pluginManagerService.getChannelRendering(pluginId);
    let content = args.content;
    if (args.products) {
      if (rendering.productRecommendations !== "text") return null;
      content = renderProductList(args.products, args.language);
      if (!content) return null;
    }
    content = renderForChannel(content, rendering);

    // Private uploads need a signature: the worker fetches each file with a plain GET.
    const deliverableAttachments = await signAttachmentUrls(
      attachments,
      organizationId,
      DELIVERY_SIGNED_URL_TTL_SECONDS,
    );
    return {
      organizationId,
      pluginId,
      channel,
      messageId,
      conversationId,
      aiDisclosed: args.aiDisclosed,
      body: JSON.stringify({
        to: args.to,
        content,
        messageId,
        messageType: args.messageType,
        conversationId,
        conversationMetadata: args.conversationMetadata,
        language: args.language,
        messageMetadata: args.messageMetadata,
        attachments: deliverableAttachments,
      }),
    };
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

    let response: Response;
    try {
      response = await workerFetch(worker.port, "/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Refused = the worker never saw the request. Any other network error may
      // have happened after the worker sent the message, so it is not retried.
      const refused = errorCode(error) === "ECONNREFUSED";
      logger.error(
        { err: error, port: worker.port, refused },
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

  /** Persist a provider-side failure on the message and tell dashboard clients. */
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

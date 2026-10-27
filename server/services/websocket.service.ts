import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { IncomingMessage } from "http";
import { conversationRepository } from "../repositories/conversation.repository";
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import type { JWTPayload } from "../types/auth.types";
import type { Message } from "../database/entities/message.entity";
import { MessageType } from "../database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { AppDataSource } from "@server/database/data-source";
import { UserOrganization } from "@server/entities/user-organization.entity";

const logger = createLogger("websocket");
import { verifyDPoPForRequest } from "../routes/v1/public-conversations";
import { getClientIp } from "@server/lib/client-ip";
import { PUBLIC_WIDGET_LIMITS, isPublicWidgetRateLimited } from "./public-widget-limits";

// Largest frame a client may send. Clients only send small JSON control frames
// and chat messages (capped at PUBLIC_WIDGET_LIMITS.maxMessageLength); the ws
// default of 100 MiB would let one frame exhaust memory.
const MAX_FRAME_BYTES = 64 * 1024;

interface WebSocketClient {
  ws: WebSocket;
  organizationId: string;
  customerId: string;
  conversationId?: string;
  pluginId?: string;
  authenticated: boolean;
  /** Client IP from the proxy headers; kept out of `metadata`, which identify lets the client extend. */
  ip: string;
  /** Resolves once token authentication (if any) has finished. */
  ready: Promise<void>;
  metadata: Record<string, unknown>;
}

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface IdentifyMessage extends WebSocketMessage {
  customerId: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

interface ChatMessage extends WebSocketMessage {
  content: string;
  timestamp?: number;
  proof?: string; // DPoP proof JWT
  method?: string; // HTTP method for DPoP validation
  url?: string; // Request URL for DPoP validation
  conversationId?: string; // Conversation ID for DPoP validation
}

interface TypingMessage extends WebSocketMessage {
  isTyping: boolean;
}

interface LoadHistoryMessage extends WebSocketMessage {
  limit?: number;
  offset?: number;
}

interface SubscribeMessage extends WebSocketMessage {
  events?: string[];
}

interface JWTPayloadWithOrg extends JWTPayload {
  organizationId?: string;
}

/**
 * Event broadcast over the Redis "websocket:events" channel.
 * Payload is the (untrusted) data forwarded to local clients.
 */
interface RedisEvent {
  type?: string;
  organizationId?: string;
  conversationId?: string;
  payload?: RedisEventPayload;
}

interface RedisEventPayload {
  type?: string;
  isPlayground?: boolean;
  deliveryState?: string;
  [key: string]: unknown;
}

/**
 * Event broadcast over the Redis "job:updates" channel for real-time job progress.
 */
interface JobUpdateEvent {
  jobId?: string;
  organizationId?: string;
  status?: string;
  progress?: number;
  result?: unknown;
  error?: unknown;
}

export class WebSocketService {
  private wss?: WebSocketServer;
  private clients = new Map<string, WebSocketClient>();
  private conversationClients = new Map<string, Set<string>>();
  private organizationClients = new Map<string, Set<string>>();
  private redisInitialized = false;

  /**
   * Initialize WebSocket server
   * Can run on the same HTTP server or on a separate port
   */
  async initialize(serverOrPort: Server | number): Promise<void> {
    if (typeof serverOrPort === "number") {
      // Standalone WebSocket server on a separate port
      this.wss = new WebSocketServer({
        port: serverOrPort,
        path: "/ws",
        clientTracking: true,
        maxPayload: MAX_FRAME_BYTES,
      });
      logger.debug({ port: serverOrPort }, "WebSocket server initialized on standalone port");
    } else {
      // WebSocket server attached to existing HTTP server
      this.wss = new WebSocketServer({
        server: serverOrPort,
        path: "/ws",
        clientTracking: true,
        maxPayload: MAX_FRAME_BYTES,
      });
      logger.debug("WebSocket server initialized");
    }

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    // Initialize Redis for cross-server event broadcasting
    await this.initializeRedis();
  }

  /**
   * Initialize Redis pub/sub for broadcasting events across server instances
   */
  private async initializeRedis(): Promise<void> {
    if (this.redisInitialized) {
      return;
    }

    try {
      const { redisService } = await import("./redis.service");

      // Subscribe to WebSocket events channel
      await redisService.subscribe("websocket:events", (event) => {
        this.handleRedisEvent(event);
      });

      // Subscribe to job updates channel for real-time progress
      await redisService.subscribe("job:updates", (event) => {
        this.handleJobUpdate(event);
      });

      this.redisInitialized = true;
      logger.debug("Redis pub/sub initialized for cross-server broadcasting");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize Redis");
      logger.warn("Running without Redis - events will not be broadcast across server instances");
    }
  }

  /**
   * Handle incoming Redis event and broadcast to local WebSocket clients
   */
  private handleRedisEvent(event: unknown): void {
    const { type, organizationId, conversationId, payload } = (event ?? {}) as RedisEvent;

    if (!type || !organizationId) {
      logger.error({ event }, "Invalid Redis event");
      return;
    }

    // For message_received events, broadcast based on message type and delivery state
    if (type === "message_received" && conversationId) {
      const messagePayload = {
        type: "message",
        // Include the conversation id so dashboard clients (which receive ALL
        // org messages for sidebar/visibility) can tell which open conversation
        // a message belongs to and avoid rendering it in the wrong thread.
        conversationId,
        data: payload,
      };

      // Define public message types (visible to customers via webchat)
      const publicMessageTypes = ["Customer", "BotAgent", "HumanAgent"];
      const isPublicMessage =
        payload?.type !== undefined && publicMessageTypes.includes(payload.type);
      const isPlayground = payload?.isPlayground === true;

      // Always send ALL messages to dashboard (organization clients) for full visibility
      const orgSent = this.sendToOrganization(organizationId, messagePayload);

      // Send to conversation clients (webchat) if:
      // 1. Public message type with SENT delivery state (normal webchat), OR
      // 2. ANY message type for playground conversations (demo mode shows all internal events)
      if ((isPublicMessage && payload?.deliveryState === "sent") || isPlayground) {
        const conversationSent = this.sendToConversation(conversationId, messagePayload);

        logger.debug(
          { messageType: payload?.type, conversationSent, orgSent, isPlayground },
          "Broadcasted message to conversation and org clients",
        );
      } else if (!isPublicMessage) {
        logger.debug(
          { messageType: payload?.type, orgSent },
          "Broadcasted internal message to org clients only",
        );
      } else {
        logger.debug(
          { messageType: payload?.type, orgSent },
          "Broadcasted QUEUED message to org clients only",
        );
      }
    } else if (type === "conversation_status_changed" && conversationId) {
      // Broadcast status changes to BOTH conversation clients (webchat) AND organization clients (dashboard)
      const conversationSent = this.sendToConversation(conversationId, { type, payload });
      const orgSent = this.sendToOrganization(organizationId, { type, payload });

      logger.debug(
        { type, conversationSent, orgSent },
        "Broadcasted status change to conversation and org clients",
      );
    } else if (
      type === "conversation_created" ||
      type === "conversation_updated" ||
      type === "conversation_deleted"
    ) {
      // Broadcast conversation list updates to all organization clients
      const sent = this.sendToOrganization(organizationId, { type, payload });

      logger.debug({ type, sent }, "Broadcasted event from Redis to local clients");
    } else {
      // Broadcast to all clients in the organization for other events
      const sent = this.sendToOrganization(organizationId, { type, payload });

      logger.debug({ type, sent }, "Broadcasted event from Redis to local clients");
    }
  }

  /**
   * Handle job update event from Redis and broadcast to clients
   */
  private handleJobUpdate(event: unknown): void {
    const { jobId, organizationId, status, progress, result, error } = (event ??
      {}) as JobUpdateEvent;

    if (!jobId || !organizationId) {
      logger.error({ event }, "Invalid job update event");
      return;
    }

    // Broadcast job update to all clients in the organization
    const sent = this.sendToOrganization(organizationId, {
      type: "job:progress",
      jobId,
      status,
      progress,
      result,
      error,
    });

    logger.debug({ jobId, sent }, "Broadcasted job update");
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = this.generateClientId();
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const organizationId = url.searchParams.get("org");

    // Create client object
    const client: WebSocketClient = {
      ws,
      organizationId: organizationId || "",
      customerId: "",
      authenticated: false,
      ip: getClientIp(req.headers, req.socket.remoteAddress),
      ready: Promise.resolve(),
      metadata: {
        userAgent: req.headers["user-agent"],
      },
    };

    this.clients.set(clientId, client);

    // Authentication checks org membership against the database, so it is
    // async. Frames that arrive meanwhile wait for it in handleMessage.
    client.ready = token ? this.authenticateClient(clientId, token) : Promise.resolve();

    // Set up event handlers
    ws.on("message", (data) => {
      this.handleMessage(clientId, data.toString());
    });

    ws.on("close", () => {
      this.handleDisconnect(clientId);
    });

    ws.on("error", (error) => {
      logger.error({ err: error, clientId }, "WebSocket error for client");
      this.handleDisconnect(clientId);
    });

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: "connected",
        clientId,
      }),
    );
  }

  /**
   * Authenticate WebSocket client
   */
  private async authenticateClient(clientId: string, token: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    let decoded: JWTPayloadWithOrg;
    try {
      decoded = jwt.verify(token, config.jwt.secret) as JWTPayloadWithOrg;
    } catch {
      return;
    }

    if (decoded.organizationId) {
      // The token is scoped to one organization.
      client.organizationId = decoded.organizationId;
    } else {
      // User access tokens carry no organization: the `org` query parameter is
      // only a request, so confirm the user is an active member before
      // streaming that organization's events.
      if (!decoded.userId || !client.organizationId) return;
      const membership = await AppDataSource.getRepository(UserOrganization).findOne({
        where: { userId: decoded.userId, organizationId: client.organizationId, isActive: true },
      });
      if (!membership) {
        logger.warn({ clientId }, "WebSocket client is not a member of the requested organization");
        return;
      }
    }

    client.authenticated = true;
    if (!this.organizationClients.has(client.organizationId)) {
      this.organizationClients.set(client.organizationId, new Set());
    }
    this.organizationClients.get(client.organizationId)!.add(clientId);
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(clientId: string, data: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      await client.ready;
      const message = JSON.parse(data);

      switch (message.type) {
        case "identify":
          await this.handleIdentify(clientId, message);
          break;

        case "message":
          await this.handleChatMessage(clientId, message);
          break;

        case "typing":
          await this.handleTypingIndicator(clientId, message);
          break;

        case "load_history":
          await this.handleLoadHistory(clientId, message);
          break;

        case "subscribe":
          await this.handleSubscribe(clientId, message);
          break;

        default:
          logger.debug({ messageType: message.type }, "Unknown message type");
      }
    } catch (error) {
      logger.error({ err: error, clientId }, "Failed to handle message");
      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "Invalid message format",
        }),
      );
    }
  }

  /**
   * Handle customer identification: attach a webchat client to an existing
   * conversation so it receives that conversation's public events.
   *
   * Conversations are only ever created through `publicConversations.create`,
   * which registers the browser's DPoP key. Creating one here would produce a
   * conversation with no key, writable by anyone.
   */
  private async handleIdentify(clientId: string, message: IdentifyMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { customerId, conversationId, metadata } = message;

    if (!conversationId) {
      this.sendError(client, "conversationId is required");
      return;
    }

    const conversation = await conversationRepository.findById(conversationId);
    if (
      !conversation ||
      conversation.organization_id !== client.organizationId ||
      conversation.channel !== "web"
    ) {
      this.sendError(client, "Conversation not found");
      return;
    }

    client.customerId = customerId;
    client.conversationId = conversation.id;
    client.metadata = { ...client.metadata, ...metadata };

    if (!this.conversationClients.has(conversation.id)) {
      this.conversationClients.set(conversation.id, new Set());
    }
    this.conversationClients.get(conversation.id)!.add(clientId);

    logger.debug({ conversationId: conversation.id }, "Webchat client connected to conversation");

    client.ws.send(
      JSON.stringify({
        type: "identified",
        conversationId: client.conversationId,
        customerId: client.customerId,
      }),
    );
  }

  /**
   * Handle a chat message from a webchat client.
   *
   * Every write needs a valid DPoP proof for the conversation the client
   * identified into, the same gate as `publicConversations.sendMessage`.
   */
  private async handleChatMessage(clientId: string, message: ChatMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const conversationId = client.conversationId;
    if (!conversationId) {
      this.sendError(client, "Identify with a conversation before sending messages");
      return;
    }

    if (!message.proof || !message.method || !message.url) {
      this.sendError(
        client,
        "DPoP authentication required: proof, method and url must be provided",
      );
      return;
    }

    if (
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > PUBLIC_WIDGET_LIMITS.maxMessageLength
    ) {
      this.sendError(client, "Invalid message content");
      return;
    }

    // Checked before DPoP so a flood never reaches signature verification.
    if (
      await isPublicWidgetRateLimited([
        { rule: "messagePerConversation", id: conversationId },
        { rule: "messagePerIp", id: client.ip },
      ])
    ) {
      this.sendError(client, "RATE_LIMITED");
      return;
    }

    // The proof is verified against the identified conversation. A frame that
    // names a different conversation is rejected rather than silently rerouted.
    if (message.conversationId && message.conversationId !== conversationId) {
      this.sendError(client, "Conversation mismatch");
      return;
    }

    try {
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation || conversation.channel !== "web" || !conversation.publicJwk) {
        this.sendError(client, "Conversation does not accept webchat messages");
        return;
      }

      const dpopVerification = await verifyDPoPForRequest(
        conversationId,
        message.proof,
        message.method,
        message.url,
      );

      if (!dpopVerification.success) {
        if (dpopVerification.newNonce) {
          client.ws.send(
            JSON.stringify({
              type: "error",
              error: "NONCE_EXPIRED",
              nonce: dpopVerification.newNonce,
            }),
          );
          return;
        }
        this.sendError(client, dpopVerification.error || "DPoP validation failed");
        return;
      }

      // addMessage() broadcasts the message and enqueues the orchestrator run.
      const savedMessage = await conversation.addMessage({
        content: message.content,
        type: MessageType.CUSTOMER,
        sender: "customer",
      });

      client.ws.send(
        JSON.stringify({
          type: "message_sent",
          messageId: savedMessage.id,
          nonce: dpopVerification.newNonce,
        }),
      );
    } catch (error) {
      logger.error({ err: error }, "Failed to process webchat message");
      this.sendError(client, "Failed to send message");
    }
  }

  private sendError(client: WebSocketClient, error: string): void {
    client.ws.send(JSON.stringify({ type: "error", error }));
  }

  /**
   * Handle typing indicator
   */
  private async handleTypingIndicator(clientId: string, message: TypingMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.conversationId) return;

    // Broadcast to other clients in conversation
    this.broadcastToConversation(
      client.conversationId,
      {
        type: "typing",
        userId: client.customerId,
        isTyping: message.isTyping,
      },
      clientId,
    );
  }

  /**
   * Handle load history request
   */
  private async handleLoadHistory(clientId: string, message: LoadHistoryMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { conversationId } = message;

    // Load conversation with messages
    const conversation = await conversationRepository.findById(conversationId as string);
    if (!conversation || conversation.organization_id !== client.organizationId) {
      return;
    }

    const messages = conversation?.messages || [];

    client.ws.send(
      JSON.stringify({
        type: "history",
        messages: messages.map((msg: Message) => ({
          text: msg.content,
          sender: msg.type === MessageType.CUSTOMER ? "user" : "agent",
          timestamp: msg.created_at,
          metadata: msg.metadata,
        })),
      }),
    );
  }

  /**
   * Handle subscription request
   */
  private async handleSubscribe(clientId: string, message: SubscribeMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { conversationId } = message;

    // IMPORTANT: Dashboard clients (authenticated org members) should NOT be added to conversationClients
    // They already receive ALL messages via organizationClients, so adding them to conversationClients
    // would cause duplicate message delivery
    if (client.authenticated && client.organizationId) {
      logger.debug(
        { clientId },
        "Client is authenticated org member - skipping conversationClients subscription",
      );
      // Still set conversationId for client metadata, but don't add to conversationClients map
      client.conversationId = conversationId as string;
      return;
    }

    // Webchat clients attach to their conversation through `identify`, which
    // checks the organization and channel. An unchecked subscribe would let
    // anyone listen to any conversation id.
    this.sendError(client, "Unauthorized");
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from conversation clients
    if (client.conversationId) {
      const conversationClients = this.conversationClients.get(client.conversationId);
      if (conversationClients) {
        conversationClients.delete(clientId);
        if (conversationClients.size === 0) {
          this.conversationClients.delete(client.conversationId);
        }
      }

      logger.debug(
        { conversationId: client.conversationId },
        "Webchat client disconnected from conversation",
      );
    }

    // Remove from organization clients
    if (client.organizationId) {
      const orgClients = this.organizationClients.get(client.organizationId);
      if (orgClients) {
        orgClients.delete(clientId);
        if (orgClients.size === 0) {
          this.organizationClients.delete(client.organizationId);
        }
      }
    }

    // Remove client
    this.clients.delete(clientId);
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: Record<string, unknown>): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    client.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Send message to all clients in a conversation
   */
  sendToConversation(conversationId: string, message: Record<string, unknown>): number {
    const clientIds = this.conversationClients.get(conversationId);

    if (!clientIds) {
      return 0;
    }

    let sent = 0;
    for (const clientId of clientIds) {
      if (this.sendToClient(clientId, message)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Broadcast to conversation except sender
   */
  broadcastToConversation(
    conversationId: string,
    message: Record<string, unknown>,
    excludeClientId?: string,
  ): number {
    const clientIds = this.conversationClients.get(conversationId);
    if (!clientIds) return 0;

    let sent = 0;
    for (const clientId of clientIds) {
      if (clientId !== excludeClientId && this.sendToClient(clientId, message)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Send message from plugin to conversation
   */
  sendPluginMessage(
    organizationId: string,
    conversationId: string,
    message: Record<string, unknown>,
  ): void {
    this.sendToConversation(conversationId, {
      type: "message",
      data: message,
    });
  }

  /**
   * Send message to all clients in an organization
   */
  sendToOrganization(organizationId: string, message: Record<string, unknown>): number {
    const clientIds = this.organizationClients.get(organizationId);
    if (!clientIds) return 0;

    let sent = 0;
    for (const clientId of clientIds) {
      if (this.sendToClient(clientId, message)) {
        sent++;
      }
    }

    logger.debug({ organizationId, sent }, "Sent message to organization clients");
    return sent;
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connected clients count
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get conversation clients count
   */
  getConversationCount(conversationId: string): number {
    return this.conversationClients.get(conversationId)?.size || 0;
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    // Close all client connections
    for (const [_clientId, client] of this.clients) {
      client.ws.close(1000, "Server shutting down");
    }

    // Clear maps
    this.clients.clear();
    this.conversationClients.clear();
    this.organizationClients.clear();

    // Close server
    if (this.wss) {
      this.wss.close();
    }
  }
}

export const websocketService = new WebSocketService();

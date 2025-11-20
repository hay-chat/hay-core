import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { IncomingMessage } from "http";
import { processManagerService } from "./process-manager.service";
import { pluginInstanceManagerService } from "./plugin-instance-manager.service";
import { pluginInstanceRepository } from "../repositories/plugin-instance.repository";
import { conversationRepository } from "../repositories/conversation.repository";
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import type { JWTPayload } from "../types/auth.types";
import type { Message } from "../database/entities/message.entity";
import { MessageType } from "../database/entities/message.entity";
import { debugLog } from "@server/lib/debug-logger";
import { verifyDPoPForRequest } from "../routes/v1/public-conversations";

interface WebSocketClient {
  ws: WebSocket;
  organizationId: string;
  customerId: string;
  conversationId?: string;
  pluginId?: string;
  authenticated: boolean;
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
      });
      debugLog("websocket", `WebSocket server initialized on standalone port ${serverOrPort}`);
    } else {
      // WebSocket server attached to existing HTTP server
      this.wss = new WebSocketServer({
        server: serverOrPort,
        path: "/ws",
        clientTracking: true,
      });
      debugLog("websocket", "WebSocket server initialized");
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
      debugLog("websocket", "Redis pub/sub initialized for cross-server broadcasting");
    } catch (error) {
      console.error("[WebSocket] Failed to initialize Redis:", error);
      console.warn(
        "[WebSocket] Running without Redis - events will not be broadcast across server instances",
      );
    }
  }

  /**
   * Handle incoming Redis event and broadcast to local WebSocket clients
   */
  private handleRedisEvent(event: any): void {
    const { type, organizationId, conversationId, payload } = event;

    if (!type || !organizationId) {
      console.error("[WebSocket] Invalid Redis event:", event);
      return;
    }

    // For message_received events, broadcast based on delivery state
    if (type === "message_received" && conversationId) {
      const messagePayload = {
        type: "message",
        data: payload,
      };

      // Always send to dashboard (organization clients) for review/monitoring
      const orgSent = this.sendToOrganization(organizationId, messagePayload);

      // Only send to webchat (conversation clients) if deliveryState is SENT
      // QUEUED messages should not be sent to customers until approved
      if (payload.deliveryState === "sent") {
        const conversationSent = this.sendToConversation(conversationId, messagePayload);

        debugLog(
          "websocket",
          `Broadcasted SENT message to ${conversationSent} conversation clients and ${orgSent} org clients`,
        );
      } else {
        debugLog(
          "websocket",
          `Broadcasted QUEUED message to ${orgSent} org clients only (not to conversation)`,
        );
      }
    } else if (type === "conversation_status_changed" && conversationId) {
      // Broadcast status changes to BOTH conversation clients (webchat) AND organization clients (dashboard)
      const conversationSent = this.sendToConversation(conversationId, { type, payload });
      const orgSent = this.sendToOrganization(organizationId, { type, payload });

      debugLog(
        "websocket",
        `Broadcasted ${type} to ${conversationSent} conversation clients and ${orgSent} organization clients`,
      );
    } else if (
      type === "conversation_created" ||
      type === "conversation_updated" ||
      type === "conversation_deleted"
    ) {
      // Broadcast conversation list updates to all organization clients
      const sent = this.sendToOrganization(organizationId, { type, payload });

      debugLog("websocket", `Broadcasted ${type} from Redis to ${sent} local clients`);
    } else {
      // Broadcast to all clients in the organization for other events
      const sent = this.sendToOrganization(organizationId, { type, payload });

      debugLog("websocket", `Broadcasted ${type} from Redis to ${sent} local clients`);
    }
  }

  /**
   * Handle job update event from Redis and broadcast to clients
   */
  private handleJobUpdate(event: any): void {
    const { jobId, organizationId, status, progress, result, error } = event;

    if (!jobId || !organizationId) {
      console.error("[WebSocket] Invalid job update event:", event);
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

    debugLog("websocket", `Broadcasted job update for ${jobId} to ${sent} clients`);
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
      metadata: {
        userAgent: req.headers["user-agent"],
        ip: req.socket.remoteAddress,
      },
    };

    this.clients.set(clientId, client);

    // Authenticate if token provided
    if (token) {
      const authenticated = this.authenticateClient(clientId, token);
      debugLog(
        "websocket",
        `Client ${clientId} authentication: ${authenticated}, org: ${client.organizationId}`,
      );

      // Add to organization clients if authenticated
      if (client.authenticated && client.organizationId) {
        if (!this.organizationClients.has(client.organizationId)) {
          this.organizationClients.set(client.organizationId, new Set());
        }
        this.organizationClients.get(client.organizationId)!.add(clientId);
        debugLog("websocket", `Added client ${clientId} to organization ${client.organizationId}`);
      } else {
        debugLog(
          "websocket",
          `Client ${clientId} NOT added to organization (authenticated: ${client.authenticated}, org: ${client.organizationId})`,
        );
      }
    }

    // Set up event handlers
    ws.on("message", (data) => {
      this.handleMessage(clientId, data.toString());
    });

    ws.on("close", () => {
      this.handleDisconnect(clientId);
    });

    ws.on("error", (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
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
  private authenticateClient(clientId: string, token: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JWTPayloadWithOrg;
      // Keep the organizationId from query params if not in token
      if (decoded.organizationId) {
        client.organizationId = decoded.organizationId;
      }
      client.authenticated = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(clientId: string, data: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
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
          debugLog("websocket", `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Failed to handle message from ${clientId}:`, error);
      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "Invalid message format",
        }),
      );
    }
  }

  /**
   * Handle customer identification
   */
  private async handleIdentify(clientId: string, message: IdentifyMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { customerId, conversationId, metadata } = message;

    // Update client info
    client.customerId = customerId;
    client.conversationId = conversationId;
    client.metadata = { ...client.metadata, ...metadata };

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await conversationRepository.findById(conversationId);
      if (!conversation || conversation.organization_id !== client.organizationId) {
        return;
      }
    }

    if (!conversation && client.organizationId) {
      // Create new conversation
      conversation = await conversationRepository.create({
        organization_id: client.organizationId,
        customer_id: customerId,
        status: "open",
        metadata: {
          source: "webchat",
          ...metadata,
        },
      });
    }

    if (conversation) {
      client.conversationId = conversation.id;

      // Add to conversation clients map
      if (!this.conversationClients.has(conversation.id)) {
        this.conversationClients.set(conversation.id, new Set());
      }
      this.conversationClients.get(conversation.id)!.add(clientId);

      // Webchat is now a core feature, no longer requires plugin instance
      // Just log the connection for debugging
      debugLog("websocket", `Webchat client connected to conversation ${conversation.id}`);
    }

    // Send identification confirmation
    client.ws.send(
      JSON.stringify({
        type: "identified",
        conversationId: client.conversationId,
        customerId: client.customerId,
      }),
    );
  }

  /**
   * Handle chat message
   */
  private async handleChatMessage(clientId: string, message: ChatMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.conversationId) return;

    // Handle message directly in core system (webchat is now core, not a plugin)
    try {
      // Check if this is a web conversation that requires DPoP authentication
      const conversation = await conversationRepository.findById(client.conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }

      let newNonce: string | undefined;

      // If conversation has a publicJwk (web channel with DPoP), validate DPoP proof
      if (conversation.publicJwk) {
        if (!message.proof || !message.method || !message.url || !message.conversationId) {
          client.ws.send(
            JSON.stringify({
              type: "error",
              error:
                "DPoP authentication required: proof, method, url, and conversationId must be provided",
            }),
          );
          return;
        }

        // Validate DPoP proof
        const dpopVerification = await verifyDPoPForRequest(
          message.conversationId,
          message.proof,
          message.method,
          message.url,
        );

        if (!dpopVerification.success) {
          // Check if it's a nonce expiration error
          if (dpopVerification.error === "NONCE_EXPIRED" && dpopVerification.newNonce) {
            client.ws.send(
              JSON.stringify({
                type: "error",
                error: "NONCE_EXPIRED",
                nonce: dpopVerification.newNonce,
              }),
            );
            return;
          }

          // Other DPoP validation errors
          client.ws.send(
            JSON.stringify({
              type: "error",
              error: dpopVerification.error || "DPoP validation failed",
            }),
          );
          return;
        }

        // Store new nonce for response
        newNonce = dpopVerification.newNonce;
      }

      const { orchestratorWorker } = await import("@server/workers/orchestrator.worker");

      console.log(
        `[WebSocket.handleChatMessage] Saving customer message to conversation ${conversation.id}`,
      );

      // Save customer message using conversation.addMessage() to ensure broadcasting
      const savedMessage = await conversation.addMessage({
        content: message.content,
        type: MessageType.CUSTOMER,
        sender: "customer",
      });

      console.log(`[WebSocket.handleChatMessage] Message saved with ID: ${savedMessage.id}`);

      // Send confirmation with new nonce (if DPoP was validated)
      const confirmationPayload = {
        type: "message_sent",
        messageId: savedMessage.id,
        ...(newNonce && { nonce: newNonce }),
      };
      console.log(
        `[WebSocket.handleChatMessage] Sending confirmation to client:`,
        confirmationPayload,
      );
      client.ws.send(JSON.stringify(confirmationPayload));

      // Note: Message broadcasting is handled automatically by conversation.addMessage()
      // via Redis pub/sub or direct WebSocket

      // Trigger orchestrator to process the message and generate response
      console.log(
        `[WebSocket.handleChatMessage] Triggering orchestrator for conversation ${conversation.id}`,
      );
      await orchestratorWorker.tick();

      debugLog("websocket", `Webchat message processed for conversation ${conversation.id}`);
    } catch (error) {
      console.error("Failed to process webchat message:", error);
      client.ws.send(
        JSON.stringify({
          type: "error",
          error: "Failed to send message",
        }),
      );
    }
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

    // Add to conversation subscribers
    if (!this.conversationClients.has(conversationId as string)) {
      this.conversationClients.set(conversationId as string, new Set());
    }
    this.conversationClients.get(conversationId as string)!.add(clientId as string);

    client.conversationId = conversationId as string;
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

      debugLog(
        "websocket",
        `Webchat client disconnected from conversation ${client.conversationId}`,
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
    console.log(
      `[WebSocket.sendToConversation] Conversation ${conversationId} has ${clientIds?.size || 0} clients`,
    );

    if (!clientIds) {
      console.log(
        `[WebSocket.sendToConversation] No clients found for conversation ${conversationId}`,
      );
      return 0;
    }

    let sent = 0;
    for (const clientId of clientIds) {
      console.log(`[WebSocket.sendToConversation] Attempting to send to client ${clientId}`);
      if (this.sendToClient(clientId, message)) {
        sent++;
        console.log(`[WebSocket.sendToConversation] Successfully sent to client ${clientId}`);
      } else {
        console.log(`[WebSocket.sendToConversation] Failed to send to client ${clientId}`);
      }
    }

    console.log(
      `[WebSocket.sendToConversation] Sent to ${sent}/${clientIds.size} clients in conversation ${conversationId}`,
    );
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

    debugLog("websocket", `Sent message to ${sent} clients in organization ${organizationId}`);
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

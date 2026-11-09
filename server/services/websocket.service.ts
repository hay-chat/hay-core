import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { IncomingMessage } from "http";
import { conversationRepository } from "../repositories/conversation.repository";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { config } from "../config/env";
import type { JWTPayload } from "../types/auth.types";
import { MessageType } from "../database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { AppDataSource } from "@server/database/data-source";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";
import { Session } from "@server/entities/session.entity";
import { In, IsNull, MoreThan } from "typeorm";
import { assertSsoPolicy } from "@server/lib/auth/sso/policy";

const logger = createLogger("websocket");
import {
  publicConversationProofTarget,
  socketIdentifyProofTarget,
  verifyDPoPForRequest,
} from "@server/services/webchat/dpop-proof.service";
import { getClientIp } from "@server/lib/client-ip";
import { isPageToolsOrigin, requestHostname } from "@server/lib/webchat-origin";
import { webchatSettingsService } from "./webchat/webchat-settings.service";
import {
  isWidgetVisibleMessage,
  toPublicAttachments,
  toPublicMessageEvent,
} from "./webchat/public-message";
import { PUBLIC_WIDGET_LIMITS, isPublicWidgetRateLimited } from "./public-widget-limits";
import {
  PAGE_TOOL_CALL_EVENT,
  PageToolValidationError,
  pageToolService,
  validatePageTools,
} from "./webchat/page-tools.service";

// Largest frame a client may send. Clients only send small JSON control frames
// and chat messages (capped at PUBLIC_WIDGET_LIMITS.maxMessageLength); the ws
// default of 100 MiB would let one frame exhaust memory.
const MAX_FRAME_BYTES = 64 * 1024;

/** A socket that has neither authenticated nor identified by then is closed. */
const ATTACH_TIMEOUT_MS = 10_000;
/** Pings go out this often; a socket that missed the previous pong is terminated. */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** How often a signed-in dashboard socket's user, session and membership are re-checked. */
const DASHBOARD_REVALIDATE_INTERVAL_MS = 60_000;
/** Open sockets allowed per client IP (shared NATs keep this generous). */
const MAX_CONNECTIONS_PER_IP = 100;
/** WebSocket close code for a policy violation (RFC 6455). */
const CLOSE_POLICY_VIOLATION = 1008;

interface DashboardIdentity {
  userId: string;
  email: string;
  tokenVersion?: number;
  sessionId?: string;
  /** Set when the token came from single sign-on: the one organization it may stream. */
  ssoOrganizationId?: string;
}

/** Whether a session may stream this membership's organization under the SSO rules. */
async function passesSsoPolicy(
  identity: Pick<DashboardIdentity, "userId" | "ssoOrganizationId">,
  membership: UserOrganization,
): Promise<boolean> {
  try {
    await assertSsoPolicy(
      { id: identity.userId, ssoOrganizationId: identity.ssoOrganizationId },
      membership,
    );
    return true;
  } catch (error) {
    // Only a refusal is an answer; a failed lookup must not close sockets.
    if (error instanceof TRPCError) return false;
    throw error;
  }
}

/** Whether the user behind a dashboard token may still receive that account's events. */
function isDashboardUserAllowed(
  user: Pick<User, "isActive" | "emailVerified" | "email" | "tokenVersion"> | null | undefined,
  identity: Pick<DashboardIdentity, "email" | "tokenVersion">,
): boolean {
  return (
    !!user &&
    user.isActive &&
    user.emailVerified &&
    user.email === identity.email &&
    (identity.tokenVersion === undefined || identity.tokenVersion === (user.tokenVersion ?? 0))
  );
}

interface WebSocketClient {
  ws: WebSocket;
  organizationId: string;
  conversationId?: string;
  authenticated: boolean;
  /** Who a signed-in dashboard socket belongs to; absent for widget sockets. */
  dashboardIdentity?: DashboardIdentity;
  /** Client IP from the proxy headers. */
  ip: string;
  /** The Origin header of the upgrade request; browsers always send it. */
  origin?: string;
  /** The Host header of the upgrade request. */
  host?: string;
  /** Resolves once token authentication (if any) has finished. */
  ready: Promise<void>;
  /** Whether an `auth` frame was already received; only the first one counts. */
  authAttempted: boolean;
  /** Cleared by every pong; a socket still not alive at the next ping is dead. */
  isAlive: boolean;
  attachTimer?: ReturnType<typeof setTimeout>;
}

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface AuthMessage extends WebSocketMessage {
  token?: unknown;
}

interface IdentifyMessage extends WebSocketMessage {
  conversationId?: string;
  /** DPoP proof (method GET, url `<api>/ws`) signed with the conversation's key. */
  proof?: unknown;
  /** Page tools (WebMCP) the host page registered; see page-tools.service. */
  tools?: unknown;
}

interface RegisterToolsMessage extends WebSocketMessage {
  tools?: unknown;
}

interface ToolResultMessage extends WebSocketMessage {
  callId?: unknown;
  result?: unknown;
  error?: unknown;
}

interface ChatMessage extends WebSocketMessage {
  content: string;
  timestamp?: number;
  proof?: string; // DPoP proof JWT
  conversationId?: string; // Conversation ID for DPoP validation
}

interface TypingMessage extends WebSocketMessage {
  isTyping: boolean;
}

interface SubscribeMessage extends WebSocketMessage {
  events?: string[];
}

interface DashboardTokenPayload extends JWTPayload {
  scope?: string;
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
  private connectionsPerIp = new Map<string, number>();
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private revalidateTimer?: ReturnType<typeof setInterval>;
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

    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL_MS);
    this.revalidateTimer = setInterval(() => {
      this.revalidateDashboardClients().catch((err) =>
        logger.warn({ err }, "Dashboard socket re-validation failed"),
      );
    }, DASHBOARD_REVALIDATE_INTERVAL_MS);
    this.revalidateTimer.unref();
    this.heartbeatTimer.unref();

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

      // Customer-facing types plus agent join/leave lines (visible via webchat)
      const isPublicMessage = isWidgetVisibleMessage(payload?.type, payload?.metadata);

      // Always send ALL messages to dashboard (organization clients) for full visibility
      const orgSent = this.sendToOrganization(organizationId, messagePayload);

      // Conversation clients (webchat) only get public messages once SENT.
      if (isPublicMessage && payload?.deliveryState === "sent") {
        // Files get signed links first (a DB lookup), so this send is async.
        void toPublicAttachments(payload?.attachments, organizationId)
          .catch((error) => {
            logger.warn({ err: error }, "Could not sign attachments for webchat");
            return [];
          })
          .then((attachments) => {
            const conversationSent = this.sendToConversation(
              conversationId,
              toPublicMessageEvent(conversationId, payload, attachments),
            );
            logger.debug(
              { messageType: payload?.type, conversationSent, orgSent },
              "Broadcasted message to conversation and org clients",
            );
          });
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
    } else if (type === PAGE_TOOL_CALL_EVENT && conversationId) {
      // Only the page that registered the tool may run it: never the dashboard.
      const sent = this.sendToConversation(conversationId, { type: "tool_call", ...payload });
      logger.debug({ conversationId, sent }, "Forwarded page tool call to the widget");
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
   * Handle new WebSocket connection.
   *
   * A socket has ATTACH_TIMEOUT_MS to either authenticate (dashboard: an
   * `auth` frame with an access token) or identify (webchat: an `identify`
   * frame with a DPoP proof for its conversation); otherwise it is closed.
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = getClientIp(req.headers, req.socket.remoteAddress);
    const openFromIp = this.connectionsPerIp.get(ip) ?? 0;
    if (openFromIp >= MAX_CONNECTIONS_PER_IP) {
      ws.close(CLOSE_POLICY_VIOLATION, "Too many connections");
      return;
    }
    this.connectionsPerIp.set(ip, openFromIp + 1);

    const clientId = this.generateClientId();
    const url = new URL(req.url!, `http://${req.headers.host}`);

    const client: WebSocketClient = {
      ws,
      organizationId: url.searchParams.get("org") || "",
      authenticated: false,
      ip,
      origin: req.headers.origin,
      host: req.headers.host,
      ready: Promise.resolve(),
      authAttempted: false,
      isAlive: true,
    };

    this.clients.set(clientId, client);

    client.attachTimer = setTimeout(() => {
      if (!client.authenticated && !client.conversationId) {
        ws.close(CLOSE_POLICY_VIOLATION, "Authentication timeout");
      }
    }, ATTACH_TIMEOUT_MS);
    client.attachTimer.unref?.();

    ws.on("pong", () => {
      client.isAlive = true;
    });

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

  /** Terminate sockets that did not answer the previous ping, then ping the rest. */
  private checkHeartbeats(): void {
    for (const client of this.clients.values()) {
      if (!client.isAlive) {
        client.ws.terminate();
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }

  /**
   * Close signed-in dashboard sockets whose user was disabled, changed password,
   * lost the organization or had the session revoked. A failed lookup keeps the
   * sockets open until the next pass.
   */
  private async revalidateDashboardClients(): Promise<void> {
    const watched = [...this.clients.entries()].filter(([, c]) => c.dashboardIdentity);
    if (watched.length === 0) return;

    const identities = watched.map(([, c]) => c.dashboardIdentity!);
    const userIds = [...new Set(identities.map((i) => i.userId))];
    const sessionIds = [...new Set(identities.flatMap((i) => i.sessionId ?? []))];

    const [users, memberships, liveSessions] = await Promise.all([
      AppDataSource.getRepository(User).find({ where: { id: In(userIds) } }),
      AppDataSource.getRepository(UserOrganization).find({
        where: { userId: In(userIds), isActive: true },
        relations: ["organization"],
      }),
      sessionIds.length === 0
        ? Promise.resolve([] as Session[])
        : AppDataSource.getRepository(Session).find({
            where: { id: In(sessionIds), revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
          }),
    ]);

    const usersById = new Map(users.map((u) => [u.id, u]));
    const membershipsByKey = new Map(
      memberships.map((m) => [`${m.userId}:${m.organizationId}`, m]),
    );
    const liveSessionIds = new Set(liveSessions.map((s) => s.id));

    for (const [clientId, client] of watched) {
      const identity = client.dashboardIdentity!;
      const membership = membershipsByKey.get(`${identity.userId}:${client.organizationId}`);
      const allowed =
        isDashboardUserAllowed(usersById.get(identity.userId), identity) &&
        !!membership &&
        (!identity.sessionId || liveSessionIds.has(identity.sessionId)) &&
        (await passesSsoPolicy(identity, membership));
      if (allowed) continue;

      logger.info({ clientId }, "Closing dashboard socket that is no longer authorized");
      client.authenticated = false;
      this.organizationClients.get(client.organizationId)?.delete(clientId);
      client.ws.close(CLOSE_POLICY_VIOLATION, "Unauthorized");
    }
  }

  /** Browsers send an Origin; the dashboard's must be one of the CORS origins. */
  private isAllowedDashboardOrigin(origin: string | undefined): boolean {
    if (!origin) return true; // not a browser, so no cross-site request to guard against
    const allowed = config.cors.origin;
    return Array.isArray(allowed) ? allowed.includes(origin) : allowed === origin;
  }

  /**
   * Authenticate a dashboard client with a user access token, applying the
   * same checks as bearer auth on the HTTP API.
   */
  private async authenticateClient(clientId: string, token: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!this.isAllowedDashboardOrigin(client.origin)) {
      logger.warn({ clientId }, "WebSocket authentication from a disallowed origin");
      return;
    }

    let decoded: DashboardTokenPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret, {
        algorithms: ["HS256"],
      }) as DashboardTokenPayload;
    } catch {
      return;
    }

    // Only user access tokens open a dashboard stream (not plugin or refresh tokens).
    if (decoded.scope !== undefined || decoded.type !== "access" || !decoded.userId) return;
    if (!client.organizationId) return;

    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: decoded.userId },
    });
    if (!isDashboardUserAllowed(user, decoded)) {
      logger.warn({ clientId }, "WebSocket token rejected");
      return;
    }

    // The `org` query parameter is only a request: confirm the user is an
    // active member before streaming that organization's events.
    const membership = await AppDataSource.getRepository(UserOrganization).findOne({
      where: { userId: decoded.userId, organizationId: client.organizationId, isActive: true },
      relations: ["organization"],
    });
    if (!membership) {
      logger.warn({ clientId }, "WebSocket client is not a member of the requested organization");
      return;
    }
    const ssoOrganizationId = decoded.sso;
    if (!(await passesSsoPolicy({ userId: decoded.userId, ssoOrganizationId }, membership))) {
      logger.warn({ clientId }, "WebSocket session is not allowed in the requested organization");
      return;
    }

    // The socket may have closed while the lookups ran.
    if (!this.clients.has(clientId)) return;

    client.authenticated = true;
    client.dashboardIdentity = {
      userId: decoded.userId,
      email: decoded.email,
      tokenVersion: decoded.tokenVersion,
      sessionId: decoded.sid,
      ssoOrganizationId,
    };
    if (!this.organizationClients.has(client.organizationId)) {
      this.organizationClients.set(client.organizationId, new Set());
    }
    this.organizationClients.get(client.organizationId)!.add(clientId);
  }

  /** First `auth` frame of a dashboard socket; the result is sent back as a frame. */
  private async handleAuth(clientId: string, message: AuthMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;
    if (typeof message.token === "string" && message.token) {
      await this.authenticateClient(clientId, message.token);
    }
    if (client.authenticated) {
      client.ws.send(JSON.stringify({ type: "authenticated" }));
    } else {
      this.sendError(client, "Unauthorized");
      client.ws.close(CLOSE_POLICY_VIOLATION, "Unauthorized");
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

      // Authentication starts synchronously so frames queued behind it wait.
      if (message?.type === "auth") {
        if (client.authAttempted) return;
        client.authAttempted = true;
        client.ready = this.handleAuth(clientId, message);
        await client.ready;
        return;
      }

      await client.ready;

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

        case "subscribe":
          await this.handleSubscribe(clientId, message);
          break;

        case "register_tools":
          await this.handleRegisterTools(clientId, message);
          break;

        case "tool_result":
          await this.handleToolResult(clientId, message);
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
   * The frame carries a DPoP proof signed with the key the browser registered
   * when it created the conversation, so only the holder of that key can
   * listen. Conversations are only ever created through
   * `publicConversations.create`; creating one here would produce a
   * conversation with no key, writable by anyone.
   */
  private async handleIdentify(clientId: string, message: IdentifyMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { conversationId, proof } = message;

    if (typeof conversationId !== "string" || !conversationId) {
      this.sendError(client, "conversationId is required");
      return;
    }

    if (typeof proof !== "string") {
      this.sendError(client, "DPoP authentication required: proof must be provided");
      return;
    }

    const conversation = await conversationRepository.findById(conversationId);
    if (
      !conversation ||
      conversation.organization_id !== client.organizationId ||
      conversation.channel !== "web" ||
      !conversation.publicJwk
    ) {
      this.sendError(client, "Conversation not found");
      return;
    }

    // The nonce is left alone: the widget's HTTP calls rotate it concurrently,
    // and the one-time jti plus the iat window already stop replays.
    const verification = await verifyDPoPForRequest(
      conversation.id,
      proof,
      socketIdentifyProofTarget(client.host),
      { checkNonce: false },
    );
    if (!verification.success) {
      this.sendError(client, "Unauthorized");
      return;
    }

    // The socket may have closed while the proof was verified.
    if (!this.clients.has(clientId)) return;

    // A shopper who starts a new conversation identifies again on the same socket.
    if (client.conversationId !== conversation.id) this.detachFromConversation(clientId, client);
    client.conversationId = conversation.id;

    if (!this.conversationClients.has(conversation.id)) {
      this.conversationClients.set(conversation.id, new Set());
    }
    this.conversationClients.get(conversation.id)!.add(clientId);

    logger.debug({ conversationId: conversation.id }, "Webchat client connected to conversation");

    if (message.tools !== undefined) await this.registerPageTools(client, message.tools);

    client.ws.send(
      JSON.stringify({
        type: "identified",
        conversationId: client.conversationId,
      }),
    );
  }

  /** The host page registered (or changed) its page tools after identifying. */
  private async handleRegisterTools(
    clientId: string,
    message: RegisterToolsMessage,
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client?.conversationId) return;
    await this.registerPageTools(client, message.tools);
  }

  private async registerPageTools(client: WebSocketClient, tools: unknown): Promise<void> {
    if (!client.conversationId || !pageToolService.isEnabled()) return;
    const settings = await webchatSettingsService.getSettings(client.organizationId);
    if (!isPageToolsOrigin(settings, requestHostname({ origin: client.origin }))) {
      if (Array.isArray(tools) && tools.length > 0) {
        this.sendError(client, "Page tools are not enabled for this site");
      }
      return;
    }
    try {
      await pageToolService.register(client.conversationId, validatePageTools(tools));
    } catch (error) {
      if (!(error instanceof PageToolValidationError)) throw error;
      logger.warn(
        { conversationId: client.conversationId, reason: error.message },
        "Page tools rejected",
      );
      this.sendError(client, `Page tools rejected: ${error.message}`);
    }
  }

  /** The page ran a tool the AI asked for; hand the answer to whoever is waiting. */
  private async handleToolResult(clientId: string, message: ToolResultMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client?.conversationId || typeof message.callId !== "string") return;
    await pageToolService.resolve(message.callId, client.conversationId, {
      result: message.result,
      ...(message.error !== undefined ? { error: String(message.error) } : {}),
    });
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

    if (!message.proof) {
      this.sendError(client, "DPoP authentication required: proof must be provided");
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

    // Per IP before DPoP so a flood never reaches signature verification.
    if (await isPublicWidgetRateLimited([{ rule: "messagePerIp", id: client.ip }])) {
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
        publicConversationProofTarget("sendMessage", client.host),
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

      // Per conversation only after the proof checks out, so knowing a
      // conversationId is not enough to spend (and mute) a shopper's budget.
      if (
        await isPublicWidgetRateLimited([
          { rule: "messagePerConversation", id: conversationId },
          { rule: "messagePerOrg", id: conversation.organization_id },
          { rule: "messagePerOrgHourly", id: conversation.organization_id },
        ])
      ) {
        this.sendError(client, "RATE_LIMITED");
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
        isTyping: message.isTyping === true,
      },
      clientId,
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
    // requires a DPoP proof for it. An unchecked subscribe would let
    // anyone listen to any conversation id.
    this.sendError(client, "Unauthorized");
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    clearTimeout(client.attachTimer);
    const openFromIp = (this.connectionsPerIp.get(client.ip) ?? 1) - 1;
    if (openFromIp > 0) this.connectionsPerIp.set(client.ip, openFromIp);
    else this.connectionsPerIp.delete(client.ip);

    this.detachFromConversation(clientId, client);

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

  /** Stop streaming a conversation to this client. */
  private detachFromConversation(clientId: string, client: WebSocketClient): void {
    if (!client.conversationId) return;

    const conversationClients = this.conversationClients.get(client.conversationId);
    if (conversationClients) {
      conversationClients.delete(clientId);
      if (conversationClients.size === 0) {
        this.conversationClients.delete(client.conversationId);
        void pageToolService.clear(client.conversationId);
      }
    }

    logger.debug(
      { conversationId: client.conversationId },
      "Webchat client disconnected from conversation",
    );
    client.conversationId = undefined;
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
    clearInterval(this.heartbeatTimer);
    clearInterval(this.revalidateTimer);

    // Close all client connections
    for (const [_clientId, client] of this.clients) {
      client.ws.close(1000, "Server shutting down");
    }

    // Clear maps
    this.clients.clear();
    this.conversationClients.clear();
    this.organizationClients.clear();
    this.connectionsPerIp.clear();

    // Close server
    if (this.wss) {
      this.wss.close();
    }
  }
}

export const websocketService = new WebSocketService();

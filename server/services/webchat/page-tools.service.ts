import { v4 as uuidv4 } from "uuid";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";

/**
 * Page tools: tools the page that embeds the widget registers in the browser
 * (WebMCP shape: `navigator.modelContext.registerTool` / `HayChat.registerTool`)
 * and the AI calls inside the visitor's own session.
 *
 * The widget sends the descriptors on `identify`; they live here only while a
 * socket for the conversation is open. A call goes down the conversation's
 * socket as `tool_call` and comes back as `tool_result`. Both legs are bridged
 * over Redis so the orchestrator worker and the socket may sit on different
 * server instances; without Redis everything stays in this process.
 *
 * Page tools skip the merchant approval gate on purpose: they run in the
 * visitor's browser, in front of the visitor, touch no provider and carry no
 * secret. The page author decides what the AI may do by registering only that.
 */

const logger = createLogger("page-tools");

/** Planner-visible prefix: `page:add_to_cart`. */
export const PAGE_TOOL_PREFIX = "page:";
export const PAGE_TOOLS_REDIS_PREFIX = "webchat:page-tools:";
export const PAGE_TOOL_RESULTS_CHANNEL = "webchat:page-tool-results";
export const PAGE_TOOL_CALL_EVENT = "page_tool_call";
/** How long a registration lives without a refresh (sockets re-identify on reconnect). */
const REGISTRATION_TTL_SECONDS = 60 * 60;
export const PAGE_TOOL_TIMEOUT_MS = 15_000;

export const PAGE_TOOL_LIMITS = {
  maxTools: 32,
  maxNameLength: 64,
  maxDescriptionLength: 500,
  maxBytes: 32 * 1024,
} as const;

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export interface PageToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the arguments; `{ type: "object" }` when the page gave none. */
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

/** What the page sent back for one call. */
export interface PageToolOutcome {
  result?: unknown;
  error?: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function isPageTool(fullToolName: string): boolean {
  return fullToolName.startsWith(PAGE_TOOL_PREFIX);
}

export function pageToolName(fullToolName: string): string {
  return fullToolName.slice(PAGE_TOOL_PREFIX.length);
}

/** Thrown for a registration the server refuses; the message is safe to send back. */
export class PageToolValidationError extends Error {}

/**
 * Check what a page sent and keep only what the planner needs. Throws
 * PageToolValidationError with a reason the widget can log.
 */
export function validatePageTools(input: unknown): PageToolDescriptor[] {
  if (!Array.isArray(input)) throw new PageToolValidationError("tools must be an array");
  if (input.length > PAGE_TOOL_LIMITS.maxTools) {
    throw new PageToolValidationError(`at most ${PAGE_TOOL_LIMITS.maxTools} page tools`);
  }
  const seen = new Set<string>();
  const tools = input.map((raw, index): PageToolDescriptor => {
    const tool = (raw ?? {}) as Record<string, unknown>;
    const name = typeof tool.name === "string" ? tool.name : "";
    if (!name || name.length > PAGE_TOOL_LIMITS.maxNameLength || !NAME_PATTERN.test(name)) {
      throw new PageToolValidationError(`tool #${index}: invalid name`);
    }
    if (seen.has(name)) throw new PageToolValidationError(`tool "${name}" registered twice`);
    seen.add(name);
    const description = typeof tool.description === "string" ? tool.description.trim() : "";
    if (!description || description.length > PAGE_TOOL_LIMITS.maxDescriptionLength) {
      throw new PageToolValidationError(`tool "${name}": description missing or too long`);
    }
    const inputSchema =
      tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: "object" };
    const readOnlyHint = (tool.annotations as { readOnlyHint?: unknown } | undefined)?.readOnlyHint;
    return {
      name,
      description,
      inputSchema,
      ...(typeof readOnlyHint === "boolean" ? { annotations: { readOnlyHint } } : {}),
    };
  });
  if (JSON.stringify(tools).length > PAGE_TOOL_LIMITS.maxBytes) {
    throw new PageToolValidationError("page tools exceed the size limit");
  }
  return tools;
}

/**
 * Turn what the page returned into what the LLM reads. MCP-shaped results
 * (`{ content: [{ type: "text", text }] }`) become their text; `isError`
 * becomes a tool error; anything else is passed through for JSON-serialisation.
 */
export function unwrapPageToolResult(result: unknown): unknown {
  const shaped = result as { content?: unknown; isError?: unknown } | null;
  if (!shaped || typeof shaped !== "object" || !Array.isArray(shaped.content)) return result;
  const text = shaped.content
    .map((item) => {
      const part = item as { type?: unknown; text?: unknown };
      return part?.type === "text" && typeof part.text === "string"
        ? part.text
        : JSON.stringify(part);
    })
    .join("\n");
  if (shaped.isError === true) throw new Error(text || "Page tool failed");
  return text;
}

class PageToolService {
  private memory = new Map<string, PageToolDescriptor[]>();
  private pending = new Map<string, PendingCall>();
  private subscribing: Promise<void> | null = null;

  isEnabled(): boolean {
    return config.webchat.pageTools;
  }

  private async redis() {
    const { redisService } = await import("@server/services/redis.service");
    return redisService.isConnected() ? redisService : null;
  }

  /** Store the page's descriptors for the conversation (replaces the previous set). */
  async register(conversationId: string, tools: PageToolDescriptor[]): Promise<void> {
    if (!this.isEnabled()) return;
    const redis = await this.redis();
    const client = redis?.getClient();
    if (client) {
      const key = PAGE_TOOLS_REDIS_PREFIX + conversationId;
      if (tools.length === 0) await client.del(key);
      else await client.set(key, JSON.stringify(tools), "EX", REGISTRATION_TTL_SECONDS);
    }
    // Keep a local copy too: it answers when Redis is down and costs nothing.
    if (tools.length === 0) this.memory.delete(conversationId);
    else this.memory.set(conversationId, tools);
    logger.debug({ conversationId, tools: tools.map((t) => t.name) }, "Page tools registered");
  }

  /** The page went away: its tools go with it. */
  async clear(conversationId: string): Promise<void> {
    this.memory.delete(conversationId);
    const client = (await this.redis())?.getClient();
    if (client) await client.del(PAGE_TOOLS_REDIS_PREFIX + conversationId);
  }

  async list(conversationId: string): Promise<PageToolDescriptor[]> {
    if (!this.isEnabled()) return [];
    const client = (await this.redis())?.getClient();
    if (client) {
      try {
        const raw = await client.get(PAGE_TOOLS_REDIS_PREFIX + conversationId);
        if (raw) return JSON.parse(raw) as PageToolDescriptor[];
        return [];
      } catch (error) {
        logger.warn({ err: error, conversationId }, "Could not read page tools from Redis");
      }
    }
    return this.memory.get(conversationId) ?? [];
  }

  /**
   * Ask the page to run a tool and wait for its answer. Rejects when no page
   * is listening, when the page reports an error, or after PAGE_TOOL_TIMEOUT_MS
   * (tab closed mid-call): the orchestrator turns that into a tool error the
   * LLM can react to, like any MCP failure.
   */
  async call(
    conversationId: string,
    organizationId: string,
    name: string,
    args: Record<string, unknown>,
    timeoutMs = PAGE_TOOL_TIMEOUT_MS,
  ): Promise<unknown> {
    if (!this.isEnabled()) throw new Error("Page tools are disabled on this server");
    const callId = uuidv4();
    const outcome = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`Page tool "${name}" did not answer within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(callId, { resolve, reject, timer });
    });

    try {
      await this.subscribeToResults();
      const delivered = await this.deliverCall(conversationId, organizationId, {
        callId,
        name,
        args,
      });
      if (!delivered) throw new Error(`No page is connected to run "${name}"`);
    } catch (error) {
      this.settle(callId, { error: (error as Error).message });
    }
    return outcome;
  }

  /**
   * The page answered. Called by the socket server that holds the page's
   * connection; settles locally or forwards to the instance that is waiting.
   */
  async resolve(callId: string, outcome: PageToolOutcome): Promise<void> {
    if (this.settle(callId, outcome)) return;
    const redis = await this.redis();
    if (redis) await redis.publish(PAGE_TOOL_RESULTS_CHANNEL, { callId, ...outcome });
    else logger.debug({ callId }, "Page tool result for an unknown call");
  }

  /** True when this instance was waiting for the call. */
  private settle(callId: string, outcome: PageToolOutcome): boolean {
    const waiting = this.pending.get(callId);
    if (!waiting) return false;
    this.pending.delete(callId);
    clearTimeout(waiting.timer);
    if (outcome.error !== undefined) waiting.reject(new Error(String(outcome.error)));
    else waiting.resolve(outcome.result);
    return true;
  }

  /** Send the call to the page: over Redis when there is one, else straight to the local socket. */
  private async deliverCall(
    conversationId: string,
    organizationId: string,
    payload: { callId: string; name: string; args: Record<string, unknown> },
  ): Promise<boolean> {
    const { websocketService } = await import("@server/services/websocket.service");
    const frame = { type: "tool_call", ...payload };
    const redis = await this.redis();
    if (!redis) return websocketService.sendToConversation(conversationId, frame) > 0;
    // Another instance may hold the socket, so delivery can't be confirmed here;
    // the timeout covers a page that is gone.
    await redis.publish("websocket:events", {
      type: PAGE_TOOL_CALL_EVENT,
      organizationId,
      conversationId,
      payload,
    });
    return true;
  }

  /** Subscribe once Redis is there; tried again on the next call until it is. */
  private subscribeToResults(): Promise<void> {
    return (this.subscribing ??= (async () => {
      const redis = await this.redis();
      if (!redis) {
        this.subscribing = null;
        return;
      }
      await redis.subscribe(PAGE_TOOL_RESULTS_CHANNEL, (event) => {
        const { callId, result, error } = (event ?? {}) as { callId?: string } & PageToolOutcome;
        if (typeof callId === "string") this.settle(callId, { result, error });
      });
    })().catch((error) => {
      this.subscribing = null;
      logger.warn({ err: error }, "Could not subscribe to page tool results");
    }));
  }
}

export const pageToolService = new PageToolService();

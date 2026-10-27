import { AppDataSource } from "@server/database/data-source";
import { ActionLog, type ActionOutcome } from "@server/database/entities/action-log.entity";
import type { ToolRisk } from "@server/services/core/tool-risk";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("action-log");

/** Arg keys whose values never reach the log. */
const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cookie|cvv|cvc|card[_-]?number|iban/i;
const REDACTED = "[redacted]";

/**
 * Copy of the args with sensitive values replaced. Conversation secrets are
 * injected after this point, so `<<secret.x>>` placeholders stay as written.
 */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactArgs(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactArgs(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * The tool-errors code of a failed call. Plugin tools return
 * `{ code, retryable, message }` as their MCP error text; anything else
 * (core failures, tools that predate tool-errors) is INTERNAL.
 */
export function toolErrorCode(errorDetails: unknown): string {
  let parsed: unknown = errorDetails;
  if (typeof errorDetails === "string") {
    try {
      parsed = JSON.parse(errorDetails);
    } catch {
      return "INTERNAL";
    }
  }
  const code = (parsed as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z_]{3,32}$/.test(code) ? code : "INTERNAL";
}

export interface ActionLogEntry {
  organizationId: string;
  conversationId: string;
  messageId?: string | null;
  pluginId: string | null;
  toolName: string;
  risk: ToolRisk;
  args: Record<string, unknown>;
  outcome: ActionOutcome;
  errorCode?: string | null;
  durationMs: number;
  idempotencyKey?: string | null;
}

export class ActionLogService {
  /** Write one row. Never throws: losing an audit row must not fail the turn. */
  async record(entry: ActionLogEntry): Promise<void> {
    try {
      const row = AppDataSource.getRepository(ActionLog).create({
        organization_id: entry.organizationId,
        conversation_id: entry.conversationId,
        message_id: entry.messageId ?? null,
        plugin_id: entry.pluginId,
        tool_name: entry.toolName,
        category: entry.risk.category,
        read_only: entry.risk.readOnly,
        args: redactArgs(entry.args) as Record<string, unknown>,
        outcome: entry.outcome,
        error_code: entry.errorCode ?? null,
        duration_ms: entry.durationMs,
        idempotency_key: entry.idempotencyKey ?? null,
      });
      await AppDataSource.getRepository(ActionLog).save(row);
    } catch (err) {
      logger.error(
        { err, conversationId: entry.conversationId, toolName: entry.toolName },
        "Failed to write action log",
      );
    }
  }
}

export const actionLogService = new ActionLogService();

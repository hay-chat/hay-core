/**
 * Plain-text rendering of conversations and messages. Pure functions.
 */

export interface Msg {
  id: string;
  type: string;
  content: string;
  createdAt: string;
  sender?: string | null;
  metadata?: Record<string, unknown> | null;
}

type Raw = Record<string, unknown>;

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function compactJson(value: unknown, max: number): string {
  if (value === undefined) return "";
  return truncate(typeof value === "string" ? value : JSON.stringify(value), max);
}

/** Accepts both the public widget shape (createdAt) and the entity shape (created_at). */
export function normalizeMessage(raw: Raw): Msg {
  return {
    id: String(raw.id),
    type: String(raw.type),
    content: str(raw.content) ?? "",
    createdAt: str(raw.createdAt) ?? str(raw.created_at) ?? "",
    sender: str(raw.sender) ?? null,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? null,
  };
}

export function sortMessages(messages: Msg[]): Msg[] {
  return [...messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function clock(iso: string): string {
  return iso.length >= 19 ? iso.slice(11, 19) : iso;
}

function indentContinuation(text: string): string {
  return text.replace(/\n/g, "\n    ");
}

function botAnnotations(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.confidence === "number") {
    parts.push(
      `conf ${meta.confidence.toFixed(2)}${meta.confidenceTier ? ` ${meta.confidenceTier}` : ""}`,
    );
  }
  const docs = meta.documentsUsed as Array<{ title?: string; similarity?: number }> | undefined;
  if (Array.isArray(docs) && docs.length > 0) {
    const list = docs
      .slice(0, 4)
      .map(
        (d) =>
          `${truncate(d.title ?? "?", 40)}${typeof d.similarity === "number" ? `(${d.similarity.toFixed(2)})` : ""}`,
      )
      .join(", ");
    parts.push(`docs: ${list}${docs.length > 4 ? ` +${docs.length - 4}` : ""}`);
  }
  if (meta.recheckAttempted) parts.push(`rechecks ${meta.recheckCount ?? 1}`);
  if (meta.isHandoffMessage) parts.push(`handoff${meta.handoffType ? `:${meta.handoffType}` : ""}`);
  if (meta.blockReason) parts.push(`blocked: ${String(meta.blockReason)}`);
  const claim = meta.actionClaim as { passed?: boolean } | undefined;
  if (claim && claim.passed === false) parts.push("action-claim FAILED");
  return parts.length > 0 ? `  [${parts.join("; ")}]` : "";
}

export function formatMessage(message: Msg, options: { verbose?: boolean } = {}): string {
  const meta = message.metadata ?? {};
  const max = options.verbose ? 100_000 : 600;
  const at = clock(message.createdAt);

  switch (message.type) {
    case "Tool": {
      const name = str(meta.toolName) ?? "tool";
      const status = str(meta.toolStatus) ?? "";
      const latency = typeof meta.toolLatencyMs === "number" ? ` ${meta.toolLatencyMs}ms` : "";
      const error = meta.toolErrorCode ? ` error=${String(meta.toolErrorCode)}` : "";
      const io = options.verbose ? 100_000 : 160;
      const input = meta.toolInput !== undefined ? ` in=${compactJson(meta.toolInput, io)}` : "";
      const output =
        meta.toolOutput !== undefined ? ` out=${compactJson(meta.toolOutput, io)}` : "";
      return `${at} Tool ${name} ${status}${latency}${error}${input}${output}`.trimEnd();
    }
    case "Document":
      return `${at} Document: ${str(meta.documentTitle) ?? truncate(message.content, 120)}`;
    case "Playbook":
      return `${at} Playbook: ${str(meta.playbookTitle) ?? truncate(message.content, 120)}`;
    case "System":
      // System prompts are long and identical across turns: one line unless verbose.
      return options.verbose
        ? `${at} System: ${indentContinuation(message.content)}`
        : `${at} System: ${truncate(message.content.replace(/\s+/g, " ").trim(), 160)}`;
    case "BotAgent":
      return `${at} Bot: ${indentContinuation(truncate(message.content, max))}${botAnnotations(meta)}`;
    case "HumanAgent":
      return `${at} Human${message.sender ? `(${message.sender})` : ""}: ${indentContinuation(truncate(message.content, max))}`;
    default:
      return `${at} ${message.type}: ${indentContinuation(truncate(message.content, max))}`;
  }
}

interface OrchestrationStatus {
  perception?: unknown;
  activePlaybook?: { id?: string; stepId?: string };
  rag?: { query?: string; results?: Array<{ title?: string; sim?: number }> } | null;
  toolLog?: Array<{ name?: string; ok?: boolean; latencyMs?: number; errorClass?: string }>;
  guardrailLog?: unknown[];
}

/** Header lines for `conv show`: status fields plus the stored orchestrator state. */
export function formatConversationHeader(conv: Raw, options: { verbose?: boolean } = {}): string[] {
  const max = options.verbose ? 100_000 : 240;
  const lines = [
    `${String(conv.id)}  status=${String(conv.status)} channel=${String(conv.channel ?? "-")}` +
      ` lang=${String(conv.language ?? "-")} title=${JSON.stringify(conv.title ?? "")}`,
    `created=${String(conv.created_at ?? conv.createdAt ?? "-")} agent=${String(conv.agent_id ?? "-")}` +
      ` playbook=${String(conv.playbook_id ?? "-")} customer=${String(conv.customer_id ?? "-")}`,
  ];
  if (conv.last_processing_error) {
    lines.push(`last_error=${compactJson(conv.last_processing_error, max)}`);
  }
  const status = (conv.orchestration_status ?? null) as OrchestrationStatus | null;
  if (!status) return lines;

  if (status.perception) lines.push(`perception: ${compactJson(status.perception, max)}`);
  if (status.activePlaybook?.id) {
    lines.push(
      `active playbook: ${status.activePlaybook.id} step=${status.activePlaybook.stepId ?? "-"}`,
    );
  }
  if (status.rag) {
    const results = (status.rag.results ?? [])
      .slice(0, 5)
      .map(
        (r) =>
          `${truncate(r.title ?? "?", 40)}(${typeof r.sim === "number" ? r.sim.toFixed(2) : "?"})`,
      )
      .join(", ");
    lines.push(
      `rag: query=${JSON.stringify(truncate(status.rag.query ?? "", 80))} -> ${results || "none"}`,
    );
  }
  if (status.toolLog && status.toolLog.length > 0) {
    const tools = status.toolLog
      .slice(-8)
      .map((t) => `${t.name}:${t.ok ? "ok" : (t.errorClass ?? "fail")}(${t.latencyMs ?? "?"}ms)`)
      .join(" ");
    lines.push(`tools: ${tools}`);
  }
  if (status.guardrailLog && status.guardrailLog.length > 0) {
    lines.push(
      `guardrail(last): ${compactJson(status.guardrailLog[status.guardrailLog.length - 1], max)}`,
    );
  }
  return lines;
}

/** Messages after `afterId` that are not from the customer: the agent's answer to it. */
export function repliesAfter(messages: Msg[], afterId: string): Msg[] {
  const index = messages.findIndex((m) => m.id === afterId);
  if (index === -1) return [];
  return messages.slice(index + 1).filter((m) => m.type !== "Customer");
}

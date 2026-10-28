/**
 * The dispute evidence model (D2-3): from stored conversations, their action
 * log and takeover events to the chronological, customer-facing record the
 * PDF renders. Pure: no database, no storage.
 *
 * In: customer messages, replies the customer actually received (AI or team),
 * tool calls (as plain sentences), hand-offs. Out: system and internal
 * messages, documents/playbooks, test-mode replies that were never sent,
 * dry-run calls, AI reasoning, scores and token counts.
 */
import type { ActionOutcome } from "@server/database/entities/action-log.entity";
import {
  MessageStatus,
  MessageType,
  type MessageAttachment,
  type MessageProviderStatus,
} from "@server/database/entities/message.entity";
import { DeliveryState } from "@server/types/message-feedback.types";
import { describeAction, findTracking } from "./action-sentence";
import { evidenceCopy, fillCopy, type EvidenceLocale, type EvidenceTemplate } from "./copy";
import { parseToolOutput, splitToolName } from "./tool-output";

export interface SourceMessage {
  id: string;
  type: MessageType;
  content: string;
  created_at: Date;
  status?: MessageStatus | null;
  deliveryState?: DeliveryState | null;
  providerStatus?: MessageProviderStatus | null;
  sender?: string | null;
  attachments?: MessageAttachment[] | null;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: unknown;
    toolStatus?: string;
    toolErrorCode?: string;
    documentsUsed?: Array<{ id: string; title: string; excerpt?: string }>;
  } | null;
}

export interface SourceConversation {
  id: string;
  channel: string;
  created_at: Date;
  messages: SourceMessage[];
}

export interface SourceActionLog {
  message_id: string | null;
  plugin_id: string | null;
  tool_name: string;
  category: string | null;
  read_only: boolean;
  outcome: ActionOutcome;
  error_code: string | null;
  /** What actually ran; an approver may have edited it after the tool message was written. */
  args: Record<string, unknown> | null;
  created_at: Date;
}

export interface SourceTakeover {
  conversation_id: string;
  started_at: Date;
  ended_at: Date | null;
  userName: string | null;
}

export type Author = "customer" | "ai" | "team";

export type TimelineEntry =
  | {
      kind: "message";
      at: Date;
      conversationId: string;
      channel: string;
      author: Author;
      text: string;
      receipt: MessageProviderStatus | null;
      attachments: MessageAttachment[];
    }
  | {
      kind: "action";
      at: Date;
      conversationId: string;
      /** Write category, or "tracking" for a tracking read. */
      fact: string;
      /** False for a request sent for approval or an error: shown in the timeline, never a key fact. */
      succeeded: boolean;
      text: string;
    }
  | { kind: "takeover"; at: Date; conversationId: string; text: string };

export interface PolicyUse {
  documentId: string;
  title: string;
  firstUsedAt: Date;
  /** The text the AI used at first use, recorded with the reply; null for older replies. */
  excerpt: string | null;
}

/** Characters of a policy document kept as evidence. */
export const POLICY_EXCERPT_CHARS = 1500;

/** A policy document's text as kept in evidence: whitespace collapsed, capped. */
export function policyExcerpt(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, POLICY_EXCERPT_CHARS);
}

export interface EvidenceTimeline {
  entries: TimelineEntry[];
  keyFacts: Extract<TimelineEntry, { kind: "action" }>[];
  policies: PolicyUse[];
  counts: { customerMessages: number; replies: number; actions: number };
  channels: string[];
  period: { from: Date; to: Date } | null;
}

/** Which action facts each template lists under "Key facts". */
const TEMPLATE_FACTS: Record<EvidenceTemplate, readonly string[] | null> = {
  generic: null,
  item_not_received: ["tracking", "address_change"],
  not_as_described: ["return", "exchange", "refund", "discount"],
  cancelled_credit: ["cancel", "refund"],
};

/** Which policy documents (by title) each template keeps. */
const TEMPLATE_POLICIES: Record<EvidenceTemplate, RegExp | null> = {
  generic: null,
  item_not_received: /ship|deliver|tracking|envio|entrega|frete|prazo|rastre/i,
  not_as_described: /return|refund|exchange|warrant|devolu|troca|reembols|garantia/i,
  cancelled_credit: /cancel|refund|reembols|estorno|devolu/i,
};

const TOOL_STATUS_OUTCOME: Record<string, ActionOutcome> = {
  SUCCESS: "success",
  ERROR: "error",
  REJECTED: "error",
  PENDING_APPROVAL: "held",
  SIMULATED: "simulated",
  NEEDS_CONFIRMATION: "confirming",
};

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Replace anything that looks like a card number (13-19 digits, Luhn-valid). */
export function maskCardNumbers(text: string, replacement: string): string {
  return text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? replacement : match;
  });
}

/** A reply reached the customer: sent (not held by test mode) and not rejected. */
function wasDelivered(message: SourceMessage): boolean {
  if (message.deliveryState && message.deliveryState !== DeliveryState.SENT) return false;
  return message.status !== MessageStatus.PENDING && message.status !== MessageStatus.REJECTED;
}

const AUTHOR_BY_TYPE: Partial<Record<MessageType, Author>> = {
  [MessageType.CUSTOMER]: "customer",
  [MessageType.BOT_AGENT]: "ai",
  [MessageType.HUMAN_AGENT]: "team",
};

export function buildTimeline(input: {
  conversations: SourceConversation[];
  actionLogs: SourceActionLog[];
  takeovers: SourceTakeover[];
  template: EvidenceTemplate;
  locale: EvidenceLocale;
  timeZone: string;
}): EvidenceTimeline {
  const copy = evidenceCopy(input.locale);
  // One tool message can carry several log rows: an approved action logs "held" and then
  // the run itself, with the approver's edits. Each row is its own event.
  const logsByMessage = new Map<string, SourceActionLog[]>();
  for (const log of input.actionLogs) {
    if (!log.message_id) continue;
    const list = logsByMessage.get(log.message_id) ?? [];
    list.push(log);
    logsByMessage.set(log.message_id, list);
  }
  const entries: TimelineEntry[] = [];
  const policies = new Map<string, PolicyUse>();
  const counts = { customerMessages: 0, replies: 0, actions: 0 };
  const channels = new Set<string>();

  for (const conversation of input.conversations) {
    channels.add(conversation.channel);
    const seenTracking = new Set<string>();
    for (const message of conversation.messages) {
      const author = AUTHOR_BY_TYPE[message.type];
      if (author) {
        if (author !== "customer" && !wasDelivered(message)) continue;
        const text = maskCardNumbers(message.content ?? "", copy.cardRemoved);
        const attachments = message.attachments ?? [];
        if (!text.trim() && attachments.length === 0) continue;
        entries.push({
          kind: "message",
          at: new Date(message.created_at),
          conversationId: conversation.id,
          channel: conversation.channel,
          author,
          text,
          receipt: author === "customer" ? null : (message.providerStatus ?? null),
          attachments,
        });
        if (author === "customer") counts.customerMessages++;
        else counts.replies++;
        if (author === "ai") {
          for (const doc of message.metadata?.documentsUsed ?? []) {
            if (!doc?.id || policies.has(doc.id)) continue;
            policies.set(doc.id, {
              documentId: doc.id,
              title: doc.title,
              firstUsedAt: new Date(message.created_at),
              excerpt: typeof doc.excerpt === "string" && doc.excerpt ? doc.excerpt : null,
            });
          }
        }
        continue;
      }
      if (message.type !== MessageType.TOOL || !message.metadata?.toolName) continue;

      const split = splitToolName(message.metadata.toolName);
      const logs: (SourceActionLog | null)[] = logsByMessage.get(message.id) ?? [null];
      for (const log of logs) {
        const outcome = log?.outcome ?? TOOL_STATUS_OUTCOME[message.metadata.toolStatus ?? ""];
        if (!outcome) continue;
        // The message keeps the final output, so only the successful run may read it.
        const toolOutput = !log || outcome === "success" ? message.metadata.toolOutput : undefined;
        const sentences = describeAction(
          {
            pluginId: log?.plugin_id ?? split.pluginId,
            toolName: log?.tool_name ?? split.toolName,
            category: log?.category ?? null,
            readOnly: log ? log.read_only : null,
            outcome,
            errorCode: log?.error_code ?? message.metadata.toolErrorCode ?? null,
            toolInput: log?.args ?? message.metadata.toolInput ?? null,
            toolOutput,
          },
          input.locale,
          input.timeZone,
        );
        const isTracking =
          (log?.read_only ?? !log?.category) &&
          findTracking(parseToolOutput(toolOutput)).length > 0;
        for (const text of sentences) {
          // The same tracking read again and again adds nothing.
          if (isTracking && seenTracking.has(text)) continue;
          if (isTracking) seenTracking.add(text);
          entries.push({
            kind: "action",
            at: new Date(log?.created_at ?? message.created_at),
            conversationId: conversation.id,
            fact: isTracking ? "tracking" : (log?.category ?? "other_write"),
            succeeded: outcome === "success",
            text: maskCardNumbers(text, copy.cardRemoved),
          });
          counts.actions++;
        }
      }
    }
  }

  const conversationIds = new Set(input.conversations.map((c) => c.id));
  for (const takeover of input.takeovers) {
    if (!conversationIds.has(takeover.conversation_id)) continue;
    const name = takeover.userName;
    entries.push({
      kind: "takeover",
      at: new Date(takeover.started_at),
      conversationId: takeover.conversation_id,
      text: name ? fillCopy(copy.takeover.startedNamed, { name }) : copy.takeover.started,
    });
    if (takeover.ended_at) {
      entries.push({
        kind: "takeover",
        at: new Date(takeover.ended_at),
        conversationId: takeover.conversation_id,
        text: name ? fillCopy(copy.takeover.endedNamed, { name }) : copy.takeover.ended,
      });
    }
  }

  // Stable: entries at the same instant keep their stored order.
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at.getTime() - b.entry.at.getTime() || a.index - b.index)
    .map(({ entry }) => entry);

  const facts = TEMPLATE_FACTS[input.template];
  const keyFacts = sorted.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "action" }> =>
      entry.kind === "action" && entry.succeeded && (facts === null || facts.includes(entry.fact)),
  );
  const policyFilter = TEMPLATE_POLICIES[input.template];
  const keptPolicies = [...policies.values()]
    .filter((policy) => !policyFilter || policyFilter.test(policy.title))
    .sort((a, b) => a.firstUsedAt.getTime() - b.firstUsedAt.getTime());

  const messageTimes = sorted.map((entry) => entry.at.getTime());
  return {
    entries: sorted,
    keyFacts,
    policies: keptPolicies,
    counts,
    channels: [...channels],
    period: messageTimes.length
      ? { from: new Date(Math.min(...messageTimes)), to: new Date(Math.max(...messageTimes)) }
      : null,
  };
}

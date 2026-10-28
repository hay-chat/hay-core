/**
 * D9-6: hold webchat spam from the AI before the orchestrator runs.
 *
 * Called from the orchestrator before it takes the conversation lock. A
 * webchat conversation is screened on each of its first MAX_SCREENED_MESSAGES
 * customer messages: heuristics first, then (only for suspicious ones, and only
 * when the owner turned it on) an easy-tier classifier. A spam verdict sets
 * `spam_flagged_at` (spam never bills, D9-5) and parks the conversation: no AI
 * reply, needs_processing cleared. Staff can clear it from the Spam view.
 *
 * Fail-open: any error in screening lets the AI answer.
 */

import { AppDataSource } from "@server/database/data-source";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { WebchatSettings } from "@server/database/entities/webchat-settings.entity";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { redactString } from "@server/lib/logger/redaction";
import {
  SPAM_THRESHOLD,
  SUSPICIOUS_THRESHOLD,
  scoreSpam,
  type SpamSignal,
} from "@server/services/spam/spam-heuristics";

/** Screen only the start of a chat: spam shows itself in the first messages. */
export const MAX_SCREENED_MESSAGES = 3;
const MAX_CLASSIFIER_CHARS = 4000;

/** Stored on conversation.metadata.spamCheck. */
export interface SpamCheckRecord {
  score: number;
  signals: SpamSignal[];
  /** Customer messages screened so far. */
  screened: number;
  checkedAt: string;
  classifier?: { isSpam: boolean; reason: string };
  /** Set when staff marked the conversation "Not spam": never screened again. */
  clearedAt?: string;
  clearedBy?: string;
}

interface HoldLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const CLASSIFIER_SCHEMA = {
  type: "object",
  properties: {
    is_spam: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["is_spam", "reason"],
  additionalProperties: false,
};

let llm: LLMService | null = null;

async function classify(
  conversation: Conversation,
  messages: string[],
  signals: SpamSignal[],
  guidance: string | null,
): Promise<{ isSpam: boolean; reason: string }> {
  llm ??= new LLMService();
  const prompt = await PromptService.getInstance().getPrompt(
    "conversation/spam-check",
    {
      guidance: guidance?.trim() || "(none)",
      signals: signals.join(", "),
      messages: redactString(messages.join("\n---\n")).slice(0, MAX_CLASSIFIER_CHARS),
    },
    { organizationId: conversation.organization_id },
  );
  const result = await llm.invokeWithMeta<string>({
    prompt,
    jsonSchema: CLASSIFIER_SCHEMA,
    tier: "easy",
    temperature: 0,
    max_tokens: 200,
    organizationId: conversation.organization_id,
  });
  const data = JSON.parse(result.content) as { is_spam?: unknown; reason?: unknown };
  if (typeof data.is_spam !== "boolean") throw new Error("Spam classifier returned no verdict");
  return { isSpam: data.is_spam, reason: String(data.reason ?? "").slice(0, 200) };
}

function botCheckDecision(conversation: Conversation): "allow" | "flag" | "deny" | null {
  const botCheck = conversation.metadata?.botCheck as { decision?: unknown } | undefined;
  const decision = botCheck?.decision;
  return decision === "allow" || decision === "flag" || decision === "deny" ? decision : null;
}

async function park(conversation: Conversation): Promise<void> {
  if (conversation.needs_processing) {
    await conversationRepository.update(conversation.id, conversation.organization_id, {
      needs_processing: false,
    });
  }
}

/**
 * Returns true when the conversation is (or has just been found to be) spam
 * and the AI must not answer it.
 */
export async function holdIfSpam(conversation: Conversation, log: HoldLogger): Promise<boolean> {
  if (conversation.channel !== "web") return false;

  if (conversation.spam_flagged_at) {
    await park(conversation);
    return true;
  }

  const previous = conversation.metadata?.spamCheck as SpamCheckRecord | undefined;
  if (previous?.clearedAt || (previous?.screened ?? 0) >= MAX_SCREENED_MESSAGES) return false;

  try {
    const rows = await AppDataSource.getRepository(Message).find({
      where: { conversation_id: conversation.id, type: MessageType.CUSTOMER },
      order: { created_at: "ASC" },
      take: MAX_SCREENED_MESSAGES,
      select: ["id", "content"],
    });
    const messages = rows.map((row) => row.content ?? "");
    if (messages.length === 0 || messages.length <= (previous?.screened ?? 0)) return false;

    const { score, signals } = scoreSpam({
      messages,
      botCheckDecision: botCheckDecision(conversation),
    });
    const record: SpamCheckRecord = {
      score,
      signals,
      screened: messages.length,
      checkedAt: new Date().toISOString(),
    };

    let isSpam = score >= SPAM_THRESHOLD;
    if (!isSpam && score >= SUSPICIOUS_THRESHOLD) {
      const settings = await AppDataSource.getRepository(WebchatSettings).findOne({
        where: { organizationId: conversation.organization_id },
        select: ["id", "spamClassifierEnabled", "spamGuidance"],
      });
      if (settings?.spamClassifierEnabled) {
        try {
          record.classifier = await classify(conversation, messages, signals, settings.spamGuidance);
          isSpam = record.classifier.isSpam;
        } catch (error) {
          log.warn({ err: error }, "Spam classifier failed; letting the AI answer");
        }
      }
    }

    const metadata = { ...(conversation.metadata ?? {}), spamCheck: record };
    if (!isSpam) {
      await conversationRepository.update(conversation.id, conversation.organization_id, {
        metadata,
      });
      conversation.metadata = metadata;
      return false;
    }

    const reason = record.classifier ? "classifier" : signals.join(",");
    await conversationRepository.update(conversation.id, conversation.organization_id, {
      metadata,
      spam_flagged_at: new Date(),
      spam_reason: `detector:${reason}`.slice(0, 255),
      needs_processing: false,
    });
    log.info({ score, signals, classifier: !!record.classifier }, "Held webchat conversation as spam");
    return true;
  } catch (error) {
    log.warn({ err: error }, "Spam screening failed; letting the AI answer");
    return false;
  }
}

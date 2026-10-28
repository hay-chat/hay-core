/**
 * D9-7: the Inbox Spam view. Lists spam-flagged conversations with the reasons
 * the detector recorded, and lets staff correct it either way:
 *  - "Not spam" clears the flag, stops future screening and gives the
 *    conversation back to the AI when the shopper is still waiting.
 *  - "Mark as spam" flags it (never billed, D9-5) and holds it from the AI.
 *    Closes it already had stop billing (within the correctable periods);
 *    "Not spam" sends them back to the close classifier.
 */

import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { resolutionLedgerService } from "@server/services/resolution-ledger.service";
import type { SpamCheckRecord } from "@server/services/spam/spam-hold.service";

/** Reasons the Spam view can explain. Anything else shows as "other". */
export type SpamSource = "detector" | "staff" | "close_classifier" | "other";

export interface SpamListItem {
  id: string;
  title: string | null;
  channel: string | null;
  status: string;
  customerName: string | null;
  preview: string | null;
  flaggedAt: string;
  source: SpamSource;
  signals: string[];
  classifierReason: string | null;
}

interface SpamRow {
  id: string;
  title: string | null;
  channel: string | null;
  status: string;
  spam_flagged_at: Date;
  spam_reason: string | null;
  spam_check: SpamCheckRecord | null;
  customer_name: string | null;
  preview: string | null;
}

export const STAFF_SPAM_REASON = "staff";

function sourceOf(reason: string | null): SpamSource {
  if (!reason) return "other";
  if (reason.startsWith("detector:")) return "detector";
  if (reason === STAFF_SPAM_REASON) return "staff";
  if (reason === "close_classifier") return "close_classifier";
  return "other";
}

export async function listSpam(organizationId: string, limit: number): Promise<SpamListItem[]> {
  const rows = (await AppDataSource.query(
    `
      SELECT
        c.id,
        c.title,
        c.channel,
        c.status,
        c.spam_flagged_at,
        c.spam_reason,
        c.metadata -> 'spamCheck' AS spam_check,
        cust.name AS customer_name,
        (
          SELECT LEFT(m.content, 300)
          FROM messages m
          WHERE m.conversation_id = c.id AND m.type = 'Customer'
            AND m.created_at <= c.spam_flagged_at
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS preview
      FROM conversations c
      LEFT JOIN customers cust ON cust.id = c.customer_id
      WHERE c.organization_id = $1
        AND c.deleted_at IS NULL
        AND c.spam_flagged_at IS NOT NULL
      ORDER BY c.spam_flagged_at DESC
      LIMIT $2
    `,
    [organizationId, limit],
  )) as SpamRow[];

  return rows.map((row) => {
    const source = sourceOf(row.spam_reason);
    return {
      id: row.id,
      title: row.title,
      channel: row.channel,
      status: row.status,
      customerName: row.customer_name,
      preview: row.preview,
      flaggedAt: new Date(row.spam_flagged_at).toISOString(),
      source,
      signals: source === "detector" ? (row.spam_check?.signals ?? []) : [],
      classifierReason: row.spam_check?.classifier?.reason ?? null,
    };
  });
}

async function findInOrg(organizationId: string, conversationId: string) {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation || conversation.organization_id !== organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  }
  return conversation;
}

export async function markSpam(
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<void> {
  const conversation = await findInOrg(organizationId, conversationId);
  if (conversation.spam_flagged_at) return;
  const spamCheck = { ...((conversation.metadata?.spamCheck as object) ?? {}) } as Partial<SpamCheckRecord>;
  delete spamCheck.clearedAt;
  delete spamCheck.clearedBy;
  await conversationRepository.update(conversation.id, organizationId, {
    spam_flagged_at: new Date(),
    spam_reason: STAFF_SPAM_REASON,
    needs_processing: false,
    metadata: { ...(conversation.metadata ?? {}), spamCheck },
  });
  // A conversation already closed and classified must stop billing too.
  await resolutionLedgerService.markConversationSpam({ organizationId, conversationId, userId });
}

/** Returns whether the AI was asked to answer the waiting shopper. */
export async function markNotSpam(
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<{ reengaged: boolean }> {
  const conversation = await findInOrg(organizationId, conversationId);
  const spamCheck = {
    ...((conversation.metadata?.spamCheck as object) ?? {}),
    clearedAt: new Date().toISOString(),
    clearedBy: userId,
  };

  // Re-engage the AI only for a live conversation it would otherwise answer.
  const aiOwned = ["open", "processing"].includes(conversation.status) && !conversation.assigned_user_id;
  const reengage =
    aiOwned && (await conversationRepository.hasUnansweredCustomerMessage(conversation.id));

  await conversationRepository.update(conversation.id, organizationId, {
    spam_flagged_at: null,
    spam_reason: null,
    metadata: { ...(conversation.metadata ?? {}), spamCheck },
    ...(reengage ? { needs_processing: true } : {}),
  });

  // Closes that were spam only because of the flag get classified again.
  await resolutionLedgerService.clearConversationSpam({ organizationId, conversationId, userId });

  if (reengage) {
    const { orchestratorQueueService } = await import("@server/services/orchestrator-queue.service");
    await orchestratorQueueService.enqueue(conversation.id, organizationId, "ai_return");
  }
  return { reengaged: reengage };
}

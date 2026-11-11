import type { EntityManager } from "typeorm";
import { Message } from "@server/database/entities/message.entity";
import { In } from "typeorm";
import { vectorStoreService } from "./vector-store.service";

export interface AnonymizeConversationsOptions {
  /** Title left on the anonymous row. */
  title: string;
  /** Erasure removes QA issues too; retention keeps them until their own cap. */
  deleteInsightIssues: boolean;
}

export interface AnonymizeConversationsResult {
  conversationsAnonymized: number;
  messagesDeleted: number;
  embeddingsDeleted: number;
}

/** Records that quote a conversation and never cascade, because its row is only soft-deleted. */
const CONVERSATION_RECORD_TABLES = [
  "action_log",
  "pending_actions",
  "order_conversation_links",
  "team_questions",
  "notification_deliveries",
];

/**
 * Reduce conversations to anonymous analytics rows: embeddings, messages and
 * every record quoting them are deleted and all free-text columns are cleared.
 * The one implementation behind customer erasure and automatic retention.
 *
 * Only ids belonging to the organization are touched, whatever the caller
 * passes. Media files are the caller's job and must be deleted first, since
 * finding them reads the messages this removes.
 */
export async function anonymizeConversations(
  manager: EntityManager,
  organizationId: string,
  conversationIds: string[],
  options: AnonymizeConversationsOptions,
): Promise<AnonymizeConversationsResult> {
  if (!conversationIds.length) {
    return { conversationsAnonymized: 0, messagesDeleted: 0, embeddingsDeleted: 0 };
  }

  const owned: Array<{ id: string }> = await manager.query(
    `SELECT id FROM conversations WHERE id = ANY($1::uuid[]) AND organization_id = $2`,
    [conversationIds, organizationId],
  );
  const ownedIds = owned.map((row) => row.id);
  if (!ownedIds.length) {
    return { conversationsAnonymized: 0, messagesDeleted: 0, embeddingsDeleted: 0 };
  }

  const messages = await manager.getRepository(Message).find({
    where: { conversation_id: In(ownedIds) },
    select: { id: true },
  });
  const messageIds = messages.map((message) => message.id);

  // Embeddings are linked by metadata, not foreign keys.
  let embeddingsDeleted = await vectorStoreService.deleteByConversationIds(
    organizationId,
    ownedIds,
    manager,
  );
  if (messageIds.length) {
    embeddingsDeleted += await vectorStoreService.deleteByMessageIds(
      organizationId,
      messageIds,
      manager,
    );
  }

  const ids = [ownedIds];
  await manager.query(`DELETE FROM messages WHERE conversation_id = ANY($1)`, ids);
  const tables = options.deleteInsightIssues
    ? [...CONVERSATION_RECORD_TABLES, "insight_issues"]
    : CONVERSATION_RECORD_TABLES;
  for (const table of tables) {
    await manager.query(`DELETE FROM "${table}" WHERE conversation_id = ANY($1)`, ids);
  }
  await manager.query(
    `UPDATE conversation_outcomes
     SET classification_reason = NULL, exclusion_reason = NULL, exclusion_review_note = NULL
     WHERE conversation_id = ANY($1)`,
    ids,
  );
  await manager.query(
    `UPDATE conversations
     SET customer_id = NULL, title = $2, context = NULL, metadata = NULL,
         summary = NULL, resolution_metadata = NULL, orchestration_status = NULL,
         document_ids = NULL, public_jwk = NULL, spam_reason = NULL, stuck_reason = NULL,
         last_processing_error = NULL, needs_processing = false,
         deleted_at = COALESCE(deleted_at, now())
     WHERE id = ANY($1)`,
    [ownedIds, options.title],
  );

  return {
    conversationsAnonymized: ownedIds.length,
    messagesDeleted: messageIds.length,
    embeddingsDeleted,
  };
}

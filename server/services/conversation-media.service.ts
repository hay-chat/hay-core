import { AppDataSource } from "@server/database/data-source";
import { Upload } from "@server/entities/upload.entity";
import { createLogger } from "@server/lib/logger";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "./storage.service";
import { isUuid } from "./media-url.service";

/**
 * Lifecycle of conversation media (D8-3): files shoppers, staff and the AI
 * send in conversations (folder `conversation-media`).
 *
 * - Linking: when a message carrying uploads is stored, its uploads get the
 *   conversation, message and customer ids.
 * - Deleting: retention and GDPR erasure delete the stored files through
 *   storageService.delete (S3 or local disk), never by guessing paths.
 * - Sweeping: a daily job deletes media older than the organization's media
 *   retention (its `retentionDays`, or 180 days when unset) and uploads that
 *   no message ever used.
 */

const logger = createLogger("conversation-media");

/** Media retention when an organization has no `retentionDays` (Roger, 27 Oct 2026). */
export const DEFAULT_MEDIA_RETENTION_DAYS = 180;

/** An upload no message used for this long is an orphan (failed send, abandoned upload). */
export const ORPHAN_UPLOAD_GRACE_HOURS = 24;

/** Rows deleted per sweep query; the sweep loops until nothing is left or the cap. */
const SWEEP_BATCH_SIZE = 200;
const SWEEP_MAX_BATCHES = 50;

export interface MediaDeletionResult {
  deleted: number;
  failed: number;
}

interface MessageLink {
  conversationId: string;
  messageId: string;
  customerId: string | null;
}

/**
 * Attach this organization's unlinked conversation-media uploads to a message.
 * Attachments that are not Hay uploads (no upload id) are ignored; an upload
 * already linked to another message keeps its first link.
 */
export async function linkUploadsToMessage(
  organizationId: string,
  attachments: Array<{ id?: string }> | null | undefined,
  link: MessageLink,
): Promise<void> {
  const ids = (attachments ?? []).map((attachment) => attachment.id).filter(isUuid);
  if (!ids.length) return;

  await AppDataSource.createQueryBuilder()
    .update(Upload)
    .set({
      conversationId: link.conversationId,
      messageId: link.messageId,
      customerId: link.customerId,
    })
    .where("id IN (:...ids)", { ids })
    .andWhere("organization_id = :organizationId", { organizationId })
    .andWhere("folder = :folder", { folder: CONVERSATION_MEDIA_FOLDER })
    .andWhere("message_id IS NULL")
    .execute();
}

/** Delete uploads one by one; a failure is logged and counted, never thrown. */
async function deleteUploads(uploadIds: string[]): Promise<MediaDeletionResult> {
  let deleted = 0;
  let failed = 0;
  for (const uploadId of uploadIds) {
    try {
      await storageService.delete(uploadId);
      deleted++;
    } catch (error) {
      failed++;
      logger.warn(
        { uploadId, error: error instanceof Error ? error.message : String(error) },
        "Failed to delete conversation media",
      );
    }
  }
  return { deleted, failed };
}

/**
 * Delete every conversation-media file of these conversations (and of this
 * customer, when given): uploads linked to them plus uploads referenced by
 * their messages' attachments (covers messages stored before linking existed).
 *
 * Runs on the default connection, not inside the caller's transaction: a
 * deleted file can't be rolled back, so the row goes with it.
 */
export async function deleteConversationMedia(params: {
  organizationId: string;
  conversationIds: string[];
  customerId?: string;
}): Promise<MediaDeletionResult> {
  const { organizationId, conversationIds, customerId } = params;
  if (!conversationIds.length && !customerId) return { deleted: 0, failed: 0 };

  const conditions: string[] = [];
  const parameters: unknown[] = [organizationId, CONVERSATION_MEDIA_FOLDER];
  if (conversationIds.length) {
    parameters.push(conversationIds);
    const idx = parameters.length;
    conditions.push(`u.conversation_id = ANY($${idx}::uuid[])`);
    conditions.push(`u.id::text IN (
      SELECT a->>'id'
      FROM messages m
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(m.attachments) = 'array' THEN m.attachments ELSE '[]'::jsonb END
      ) a
      WHERE m.conversation_id = ANY($${idx}::uuid[])
    )`);
  }
  if (customerId) {
    parameters.push(customerId);
    conditions.push(`u.customer_id = $${parameters.length}`);
  }

  const rows: Array<{ id: string }> = await AppDataSource.query(
    `SELECT u.id FROM uploads u
     WHERE u.organization_id = $1 AND u.folder = $2 AND (${conditions.join(" OR ")})`,
    parameters,
  );
  return deleteUploads(rows.map((row) => row.id));
}

/**
 * Daily sweep: media past its organization's retention, then orphans.
 * Media in conversations on legal hold is kept.
 */
export async function sweepConversationMedia(): Promise<{
  expired: MediaDeletionResult;
  orphans: MediaDeletionResult;
}> {
  const expired = await sweep(
    `SELECT u.id FROM uploads u
     JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN conversations c ON c.id = u.conversation_id
     WHERE u.folder = $1
       AND c.legal_hold IS NOT TRUE
       AND u.created_at < now() - make_interval(days => CASE
         WHEN (o.settings->>'retentionDays') ~ '^[0-9]+$'
           AND (o.settings->>'retentionDays')::int > 0
         THEN (o.settings->>'retentionDays')::int
         ELSE $2::int
       END)
     LIMIT $3`,
    [CONVERSATION_MEDIA_FOLDER, DEFAULT_MEDIA_RETENTION_DAYS, SWEEP_BATCH_SIZE],
  );

  // Orphans: never linked to a message, or their message was deleted. A
  // message of the same organization still naming the upload keeps it (a
  // safety net should linking ever have failed).
  const orphans = await sweep(
    `SELECT u.id FROM uploads u
     LEFT JOIN conversations lc ON lc.id = u.conversation_id
     WHERE u.folder = $1
       AND u.message_id IS NULL
       AND lc.legal_hold IS NOT TRUE
       AND u.created_at < now() - make_interval(hours => $2::int)
       AND NOT EXISTS (
         SELECT 1 FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.organization_id = u.organization_id
           AND m.created_at >= u.created_at - interval '1 hour'
           AND m.attachments @> jsonb_build_array(jsonb_build_object('id', u.id::text))
       )
     LIMIT $3`,
    [CONVERSATION_MEDIA_FOLDER, ORPHAN_UPLOAD_GRACE_HOURS, SWEEP_BATCH_SIZE],
  );

  if (expired.deleted || expired.failed || orphans.deleted || orphans.failed) {
    logger.info({ expired, orphans }, "Conversation media sweep complete");
  }
  return { expired, orphans };
}

async function sweep(sql: string, parameters: unknown[]): Promise<MediaDeletionResult> {
  const total: MediaDeletionResult = { deleted: 0, failed: 0 };
  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const rows: Array<{ id: string }> = await AppDataSource.query(sql, parameters);
    if (!rows.length) break;
    const result = await deleteUploads(rows.map((row) => row.id));
    total.deleted += result.deleted;
    total.failed += result.failed;
    // Every row failed: stop instead of retrying the same rows forever.
    if (result.deleted === 0) break;
  }
  return total;
}

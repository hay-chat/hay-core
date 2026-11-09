import type { EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { deleteUploads, sweepUploads } from "./conversation-media.service";
import { DOCUMENT_IMAGES_FOLDER, parseMediaUploadId } from "./media-url.service";
import { storageService } from "./storage.service";
import { Upload } from "@server/entities/upload.entity";
import { In } from "typeorm";

/**
 * Stored files that outlive their database rows.
 *
 * - The purge queue holds objects whose upload rows are being deleted in bulk
 *   (organization deletion). It is filled in the same transaction as that
 *   deletion, so no object can be forgotten, and drained by a scheduled job.
 * - The document sweep removes files no document names any more.
 */

const logger = createLogger("storage-purge");

const PURGE_BATCH_SIZE = 200;
const PURGE_MAX_BATCHES = 50;
/** Attempts before a queue entry is left for an operator to look at. */
export const PURGE_MAX_ATTEMPTS = 20;

/** A failed entry waits this long, so one run doesn't retry it in a loop. */
const PURGE_RETRY_AFTER_MS = 5 * 60 * 1000;

/** A document file unused for this long is an orphan; editors upload before they save. */
export const DOCUMENT_ORPHAN_GRACE_DAYS = 30;

/** Queue every stored file of an organization. Call inside the deletion's transaction. */
export async function queueOrganizationUploadsForPurge(
  manager: EntityManager,
  organizationId: string,
): Promise<void> {
  await manager.query(
    `INSERT INTO storage_purge_queue (storage_path, storage_type, reason)
     SELECT path, storage_type, 'organization_delete' FROM uploads WHERE organization_id = $1`,
    [organizationId],
  );
  // The files are going, so nobody keeps pointing at a missing avatar.
  await manager.query(
    `UPDATE users SET avatar_url = NULL
     FROM uploads u
     WHERE u.organization_id = $1 AND u.folder = 'avatars' AND u.uploaded_by_id = users.id
       AND users.avatar_url LIKE '%/' || u.filename`,
    [organizationId],
  );
}

/** Delete queued objects. A failure is recorded and retried on a later run. */
export async function drainStoragePurgeQueue(): Promise<{ deleted: number; failed: number }> {
  const total = { deleted: 0, failed: 0 };
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
    const rows: Array<{ id: string; storage_path: string; storage_type: string }> =
      await AppDataSource.query(
        `SELECT id, storage_path, storage_type FROM storage_purge_queue
         WHERE attempts < $1 AND (last_attempt_at IS NULL OR last_attempt_at < $2)
         ORDER BY created_at
         LIMIT $3`,
        [PURGE_MAX_ATTEMPTS, new Date(Date.now() - PURGE_RETRY_AFTER_MS), PURGE_BATCH_SIZE],
      );
    if (!rows.length) break;

    for (const row of rows) {
      try {
        await storageService.deleteObject(row.storage_type, row.storage_path);
        await AppDataSource.query(`DELETE FROM storage_purge_queue WHERE id = $1`, [row.id]);
        total.deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await AppDataSource.query(
          `UPDATE storage_purge_queue
           SET attempts = attempts + 1, last_attempt_at = now(), last_error = $2
           WHERE id = $1`,
          [row.id, message.slice(0, 1000)],
        );
        total.failed++;
        logger.warn({ id: row.id, error: message }, "Failed to purge a stored object");
      }
    }
  }
  if (total.deleted || total.failed) logger.info(total, "Storage purge run complete");
  return total;
}

/** Delete the stored files of a deleted document; a failure is left to the orphan sweep. */
export async function deleteDocumentAttachments(
  organizationId: string,
  attachments: Array<{ url: string }> | null | undefined,
): Promise<void> {
  const ids = (attachments ?? [])
    .map((attachment) => parseMediaUploadId(attachment.url))
    .filter((id): id is string => !!id);
  if (!ids.length) return;

  const uploads = await Upload.find({
    select: { id: true },
    where: { id: In(ids), organizationId },
  });
  await deleteUploads(uploads.map((upload) => upload.id));
}

/**
 * Daily sweep: document files and editor images that no document of their
 * organization names any more (by upload id or stored file name).
 */
export async function sweepOrphanDocumentFiles(): Promise<{ deleted: number; failed: number }> {
  const result = await sweepUploads(
    `SELECT u.id FROM uploads u
     WHERE (u.folder = $1 OR u.folder LIKE 'documents/%')
       AND u.created_at < now() - make_interval(days => $2::int)
       AND NOT EXISTS (
         SELECT 1 FROM documents d
         WHERE d.organization_id = u.organization_id
           AND (
             position(u.id::text IN COALESCE(d.content, '') || COALESCE(d.content_json::text, '')
               || COALESCE(d.attachments::text, '')) > 0
             OR position(u.filename IN COALESCE(d.content, '') || COALESCE(d.content_json::text, '')
               || COALESCE(d.attachments::text, '')) > 0
           )
       )
     LIMIT $3`,
    [DOCUMENT_IMAGES_FOLDER, DOCUMENT_ORPHAN_GRACE_DAYS, PURGE_BATCH_SIZE],
  );
  if (result.deleted || result.failed) logger.info(result, "Document file sweep complete");
  return result;
}

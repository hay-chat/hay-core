/**
 * Runs the vision pass on a customer message's photos and PDFs (D8-11).
 *
 * - When a customer message with files is stored, its photos/PDFs are marked
 *   `analysis.status = "pending"` (conversation.addMessage) and this pipeline
 *   runs in the background. The webhook or widget call never waits for it.
 * - The AI turn starts after the conversation cooldown; before planning, the
 *   execution layer waits a few seconds at most for pending analyses
 *   (waitForMediaAnalysis), then goes ahead with whatever is ready.
 * - Results are written to `message.attachments[i].analysis` in one update and
 *   pushed to dashboard clients (`message_media_updated`).
 *
 * @module services/media-analysis/pipeline
 */

import pdfParse from "pdf-parse";
import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import type { ScanStatus } from "@server/entities/upload.entity";
import type {
  AttachmentAnalysis,
  Message,
  MessageAttachment,
} from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { messageRepository } from "@server/repositories/message.repository";
import { organizationRepository } from "@server/repositories/organization.repository";
import { resolveMediaSettings } from "@server/types/organization-settings.types";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "@server/services/storage.service";
import { isUuid } from "@server/services/media-url.service";
import { isScanCleared, pendingScans, waitForScans } from "@server/services/media-scan.service";
import { isAnalyzable, PDF_TYPE, READABLE_IMAGE_TYPES as IMAGE_TYPES } from "./readable";
import { toStoredAnalysis, type PrivacySettings } from "./privacy";
import { redactCardNumbers } from "./redact";
import { VisionUnavailableError, visionService, type VisionInput } from "./vision.service";

const logger = createLogger("media-analysis");

/** Stored PDF text, for the AI's view and inspect_attachment. */
export const MAX_STORED_PDF_TEXT = 4000;
/** A PDF with less text than this is treated as scanned (no text layer). */
const MIN_PDF_TEXT = 20;

/** How long an AI turn waits for pending analyses before going ahead. */
export const ANALYSIS_WAIT_MS = 8_000;
const ANALYSIS_POLL_MS = 300;
/** A pending analysis older than this is abandoned (crashed process); nobody waits for it. */
const PENDING_STALE_SECONDS = 120;
/** Longer than a clamd scan can take (30 s timeout), so the Inbox state always settles. */
const SCAN_WAIT_MS = 45_000;

/**
 * Mark a new message's files before it is stored: customer photos/PDFs as
 * analysis pending (D8-11) and documents still being virus-scanned as
 * `scan: "pending"` (D8-4), so the first broadcast already shows both.
 */
export async function markMediaPending(
  organizationId: string,
  attachments: MessageAttachment[] | undefined,
  readFiles: boolean,
): Promise<MessageAttachment[] | undefined> {
  const marked = readFiles ? markAnalysisPending(attachments) : attachments;
  if (!marked?.length) return marked;
  const scanning = new Set(
    await pendingScans(
      organizationId,
      marked.map((attachment) => attachment.id).filter(isUuid),
    ),
  );
  if (!scanning.size) return marked;
  return marked.map((attachment) =>
    scanning.has(attachment.id) ? { ...attachment, scan: "pending" as const } : attachment,
  );
}

/** True when the background pass has work on these files (analysis or scan). */
export function hasPendingMedia(attachments: MessageAttachment[] | undefined): boolean {
  return !!attachments?.some(
    (attachment) => attachment.analysis?.status === "pending" || attachment.scan === "pending",
  );
}

/** Mark the readable files of a new customer message as pending. Others are returned as-is. */
export function markAnalysisPending(
  attachments: MessageAttachment[] | undefined,
  now = new Date(),
): MessageAttachment[] | undefined {
  if (!attachments?.length) return attachments;
  return attachments.map((attachment) =>
    isAnalyzable(attachment)
      ? { ...attachment, analysis: { status: "pending", startedAt: now.toISOString() } }
      : attachment,
  );
}

/** Either `input` (ready for the vision pass) or `skipped` (why not). */
export interface LoadedFile {
  input?: VisionInput;
  /** PDF text kept for the AI's view. */
  text?: string;
  skipped?: AttachmentAnalysis;
}

/**
 * Load a file for the vision pass: this org's conversation media only. PDFs
 * become their text (a scanned PDF without text is skipped).
 */
export async function loadFileForVision(
  organizationId: string,
  attachmentId: string,
): Promise<LoadedFile> {
  const { buffer, upload } = await storageService.download(attachmentId);
  if (upload.organizationId !== organizationId || upload.folder !== CONVERSATION_MEDIA_FOLDER) {
    return { skipped: { status: "skipped", reason: "not_conversation_media" } };
  }
  // Never read a document the virus scan has not cleared (D8-4).
  if (!isScanCleared(upload.scanStatus)) {
    return { skipped: { status: "skipped", reason: "not_scanned" } };
  }

  if (upload.mimeType === PDF_TYPE) {
    const parsed = await pdfParse(buffer);
    // Card numbers are removed before the text reaches the vision model (D8-12).
    const text = redactCardNumbers((parsed.text ?? "").replace(/\s+\n/g, "\n").trim());
    if (text.length < MIN_PDF_TEXT) {
      // TODO: scanned PDFs (no text layer) need page rendering before vision.
      return { skipped: { status: "skipped", reason: "no_text" } };
    }
    return {
      input: { kind: "text", text, filename: upload.originalName },
      text: text.slice(0, MAX_STORED_PDF_TEXT),
    };
  }

  if (!IMAGE_TYPES.has(upload.mimeType)) {
    return { skipped: { status: "skipped", reason: "unsupported" } };
  }
  return { input: { kind: "image", buffer, mimeType: upload.mimeType } };
}

/** Read one file and store only what the privacy rules allow. */
async function analyzeAttachment(
  organizationId: string,
  attachment: MessageAttachment,
  privacy: PrivacySettings,
): Promise<AttachmentAnalysis> {
  const file = await loadFileForVision(organizationId, attachment.id);
  if (!file.input) return file.skipped ?? { status: "skipped", reason: "unsupported" };
  const result = await visionService.analyze(organizationId, file.input);
  return toStoredAnalysis(result, privacy, file.text);
}

/** Tell dashboard clients a message's files changed (analysis or scan). Org-only event. */
export async function publishMediaUpdate(
  organizationId: string,
  conversationId: string,
  messageId: string,
  attachments: MessageAttachment[],
): Promise<void> {
  const payload = { conversationId, messageId, attachments };
  try {
    const { redisService } = await import("@server/services/redis.service");
    if (redisService.isConnected()) {
      await redisService.publish("websocket:events", {
        type: "message_media_updated",
        organizationId,
        payload,
      });
      return;
    }
    const { websocketService } = await import("@server/services/websocket.service");
    websocketService.sendToOrganization(organizationId, { type: "message_media_updated", payload });
  } catch (error) {
    logger.warn({ err: error, messageId }, "Could not publish media update");
  }
}

/**
 * Settle a message's pending files: wait for virus scans (D8-4), then analyse
 * pending customer photos/PDFs (D8-11), and store everything in one update.
 * Never throws: each file ends as done, skipped or failed.
 */
export async function processMessageMedia(
  messageId: string,
  organizationId: string,
): Promise<void> {
  const message = await messageRepository.findByIdAndOrganization(messageId, organizationId);
  if (!hasPendingMedia(message?.attachments)) return;
  const attachments = message!.attachments!;

  const scanIds = attachments
    .filter((attachment) => attachment.scan === "pending")
    .map((attachment) => attachment.id);
  const scans = scanIds.length
    ? await waitForScans(scanIds, SCAN_WAIT_MS)
    : new Map<string, ScanStatus | null>();

  const pendingAnalysis = attachments.filter(
    (attachment) => attachment.analysis?.status === "pending",
  );
  const results = new Map<string, AttachmentAnalysis>();
  if (pendingAnalysis.length) {
    const organization = await organizationRepository.findById(organizationId);
    const settings = resolveMediaSettings(organization?.settings);
    const notWorthReading = settings.readImages
      ? await visionSkipReason(message!.conversation_id)
      : null;
    await Promise.all(
      pendingAnalysis.map(async (attachment) => {
        if (!settings.readImages) {
          results.set(attachment.id, { status: "skipped", reason: "disabled" });
          return;
        }
        if (notWorthReading) {
          results.set(attachment.id, { status: "skipped", reason: notWorthReading });
          return;
        }
        try {
          results.set(attachment.id, await analyzeAttachment(organizationId, attachment, settings));
        } catch (error) {
          const unavailable = error instanceof VisionUnavailableError;
          logger.warn(
            {
              messageId,
              attachmentId: attachment.id,
              error: error instanceof Error ? error.message : String(error),
            },
            unavailable ? "Vision unavailable for this organization" : "Vision pass failed",
          );
          results.set(attachment.id, {
            status: "failed",
            reason: unavailable ? "unavailable" : "error",
          });
        }
      }),
    );
  }

  await saveMediaResults(message!, organizationId, results, scans);
}

/**
 * Files in a conversation held as spam, or whose bot check did not verify the
 * visitor, are not worth a vision call: the AI does not answer spam, and a
 * bot flooding photos would otherwise run up the org's vision cost.
 */
async function visionSkipReason(conversationId: string): Promise<"spam" | "unverified" | null> {
  const conversation = await AppDataSource.getRepository(Conversation).findOne({
    where: { id: conversationId },
    select: { id: true, spam_flagged_at: true, metadata: true },
  });
  if (conversation?.spam_flagged_at) return "spam";
  const botCheck = conversation?.metadata?.botCheck as { decision?: unknown } | undefined;
  return botCheck?.decision === "flag" ? "unverified" : null;
}

/** Merge the results into the message's current attachments (re-read) and store them. */
async function saveMediaResults(
  message: Message,
  organizationId: string,
  results: Map<string, AttachmentAnalysis>,
  scans: Map<string, ScanStatus | null>,
): Promise<void> {
  const fresh = await messageRepository.findByIdAndOrganization(message.id, organizationId);
  const attachments = (fresh?.attachments ?? message.attachments ?? []).map((attachment) => {
    let next = attachment;
    const analysis = results.get(attachment.id);
    if (analysis) next = { ...next, analysis };
    const scan = scans.get(attachment.id);
    if (scan && scan !== "skipped" && next.scan === "pending") next = { ...next, scan };
    return next;
  });
  await messageRepository.update(message.id, { attachments });
  await publishMediaUpdate(organizationId, message.conversation_id, message.id, attachments);
}

/** Start the pass for a stored customer message without waiting for it. */
export function scheduleMessageMedia(messageId: string, organizationId: string): void {
  void processMessageMedia(messageId, organizationId).catch((error) => {
    logger.error({ err: error, messageId }, "Media analysis crashed");
  });
}

async function hasPendingAnalysis(conversationId: string): Promise<boolean> {
  const rows: unknown[] = await AppDataSource.query(
    `SELECT 1 FROM messages
     WHERE conversation_id = $1
       AND type = 'Customer'
       AND created_at > now() - make_interval(secs => $2)
       AND attachments @> '[{"analysis":{"status":"pending"}}]'::jsonb
     LIMIT 1`,
    [conversationId, PENDING_STALE_SECONDS],
  );
  return rows.length > 0;
}

/**
 * Wait (briefly) until the conversation's recent customer files are analysed,
 * so the AI reads the photo the customer just sent. Returns false on timeout;
 * the turn then goes ahead without the missing analyses.
 */
export async function waitForMediaAnalysis(
  conversationId: string,
  timeoutMs = ANALYSIS_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  try {
    while (await hasPendingAnalysis(conversationId)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, ANALYSIS_POLL_MS));
    }
    return true;
  } catch (error) {
    logger.warn({ err: error, conversationId }, "Could not check pending media analysis");
    return false;
  }
}

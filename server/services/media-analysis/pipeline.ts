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
import { isAnalyzable, PDF_TYPE, READABLE_IMAGE_TYPES as IMAGE_TYPES } from "./readable";
import { toStoredAnalysis, type PrivacySettings } from "./privacy";
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

  if (upload.mimeType === PDF_TYPE) {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? "").replace(/\s+\n/g, "\n").trim();
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
 * Analyse every pending file of a customer message and store the results.
 * Never throws: each file ends as done, skipped or failed.
 */
export async function processMessageMedia(
  messageId: string,
  organizationId: string,
): Promise<void> {
  const message = await messageRepository.findByIdAndOrganization(messageId, organizationId);
  if (!message?.attachments?.some((attachment) => attachment.analysis?.status === "pending")) {
    return;
  }

  const organization = await organizationRepository.findById(organizationId);
  const settings = resolveMediaSettings(organization?.settings);

  const results = new Map<string, AttachmentAnalysis>();
  await Promise.all(
    message.attachments
      .filter((attachment) => attachment.analysis?.status === "pending")
      .map(async (attachment) => {
        if (!settings.readImages) {
          results.set(attachment.id, { status: "skipped", reason: "disabled" });
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

  await saveAnalyses(message, organizationId, results);
}

/** Merge the results into the message's current attachments (re-read) and store them. */
async function saveAnalyses(
  message: Message,
  organizationId: string,
  results: Map<string, AttachmentAnalysis>,
): Promise<void> {
  const fresh = await messageRepository.findByIdAndOrganization(message.id, organizationId);
  const attachments = (fresh?.attachments ?? message.attachments ?? []).map((attachment) => {
    const analysis = results.get(attachment.id);
    return analysis ? { ...attachment, analysis } : attachment;
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

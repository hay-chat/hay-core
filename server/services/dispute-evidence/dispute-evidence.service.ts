/**
 * DisputeEvidenceService (D2-3): loads one or more conversations of an
 * organization and renders the dispute evidence PDF.
 *
 * - Customer-visible messages only, action results as sentences, receipts,
 *   hand-offs, policy excerpts (see timeline.ts).
 * - Image attachments are read through storageService (media is private),
 *   only when the upload belongs to the same organization, and embedded.
 * - The PDF is kept under 4 MB: images are downscaled step by step, and as a
 *   last resort left out with a note (they stay in the ZIP, D2-5).
 * - Uses whatever data the org's retention setting still keeps (no hold).
 */
import sharp from "sharp";
import { In, IsNull } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, type MessageAttachment } from "@server/database/entities/message.entity";
import { ActionLog } from "@server/database/entities/action-log.entity";
import { ConversationTakeoverEvent } from "@server/database/entities/conversation-takeover-event.entity";
import { Document } from "@server/entities/document.entity";
import { User } from "@server/entities/user.entity";
import { organizationRepository } from "@server/repositories/organization.repository";
import { storageService } from "@server/services/storage.service";
import { createLogger } from "@server/lib/logger";
import { safeTimeZone } from "@server/utils/zoned-datetime";
import { evidenceLocale, type EvidenceLocale, type EvidenceTemplate } from "./copy";
import { buildTimeline, type SourceTakeover } from "./timeline";
import {
  isImageAttachment,
  renderEvidencePdf,
  type EvidenceDocument,
  type PreparedImage,
} from "./pdf-renderer";

const logger = createLogger("dispute-evidence");

/** Shopify's dispute upload cap (Stripe allows 4.5 MB combined). */
export const EVIDENCE_PDF_MAX_BYTES = 4 * 1024 * 1024;

/** Image passes tried in order until the PDF fits; null = leave images out. */
const IMAGE_PASSES: Array<{ maxPx: number; quality: number } | null> = [
  { maxPx: 1400, quality: 72 },
  { maxPx: 900, quality: 60 },
  { maxPx: 600, quality: 45 },
  null,
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EvidenceOrder {
  label: string;
  platform: string | null;
  total: string | null;
  placedAt: string | null;
}

export interface EvidenceRequest {
  organizationId: string;
  conversationIds: string[];
  template: EvidenceTemplate;
  order?: EvidenceOrder | null;
}

export interface StoredAttachment {
  conversationId: string;
  attachment: MessageAttachment;
  buffer: Buffer;
  mimeType: string;
}

export interface EvidenceResult {
  pdf: Buffer;
  locale: EvidenceLocale;
  /** True when the PDF still exceeds the cap with every image left out. */
  overCap: boolean;
  imagesOmitted: boolean;
  /** Attachment files still in storage, for the ZIP. */
  attachments: StoredAttachment[];
  conversationIds: string[];
  storeName: string;
  generatedAt: Date;
}

export class DisputeEvidenceService {
  async render(request: EvidenceRequest): Promise<EvidenceResult> {
    const { organizationId } = request;
    const organization = await organizationRepository.findById(organizationId);
    if (!organization) throw new Error("Organization not found");

    const conversations = request.conversationIds.length
      ? await AppDataSource.getRepository(Conversation).find({
          where: {
            id: In(request.conversationIds),
            organization_id: organizationId,
            deleted_at: IsNull(),
          },
          relations: { customer: true },
          order: { created_at: "ASC" },
        })
      : [];
    const ids = conversations.map((c) => c.id);
    const [messages, actionLogs, takeovers] = ids.length
      ? await Promise.all([
          AppDataSource.getRepository(Message).find({
            where: { conversation_id: In(ids) },
            order: { created_at: "ASC" },
          }),
          AppDataSource.getRepository(ActionLog).find({
            where: { conversation_id: In(ids), organization_id: organizationId },
          }),
          this.loadTakeovers(organizationId, ids),
        ])
      : [[], [], []];

    const byConversation = new Map<string, Message[]>();
    for (const message of messages) {
      const list = byConversation.get(message.conversation_id) ?? [];
      list.push(message);
      byConversation.set(message.conversation_id, list);
    }

    const locale = evidenceLocale(
      conversations.find((c) => c.language)?.language ?? organization.defaultLanguage,
    );
    const timeZone = safeTimeZone(organization.timezone);
    const timeline = buildTimeline({
      conversations: conversations.map((c) => ({
        id: c.id,
        channel: c.channel,
        created_at: c.created_at,
        messages: byConversation.get(c.id) ?? [],
      })),
      actionLogs,
      takeovers,
      template: request.template,
      locale,
      timeZone,
    });

    const customer = conversations.find((c) => c.customer)?.customer ?? null;
    const attachments = await this.loadAttachments(organizationId, timeline.entries);
    const policyExcerpts = await this.loadPolicyExcerpts(
      organizationId,
      timeline.policies.map((p) => p.documentId),
    );
    const generatedAt = new Date();
    const base: Omit<EvidenceDocument, "images"> = {
      locale,
      timeZone,
      generatedAt,
      template: request.template,
      storeName: organization.name,
      order: request.order ?? null,
      customer: customer
        ? { name: customer.name, email: customer.email, phone: customer.phone }
        : null,
      conversations: conversations.map((c) => ({
        id: c.id,
        channel: c.channel,
        created_at: c.created_at,
      })),
      timeline,
      policyExcerpts,
    };

    const images = attachments.filter((a) => isImageAttachment(a.attachment));
    let pdf: Buffer | null = null;
    let imagesOmitted = false;
    for (const pass of IMAGE_PASSES) {
      const prepared = await this.prepareImages(images, pass);
      pdf = await renderEvidencePdf({ ...base, images: prepared });
      imagesOmitted = pass === null && images.length > 0;
      if (pdf.length <= EVIDENCE_PDF_MAX_BYTES) break;
      // No images to shrink: further passes cannot help.
      if (images.length === 0) break;
    }

    return {
      pdf: pdf!,
      locale,
      overCap: pdf!.length > EVIDENCE_PDF_MAX_BYTES,
      imagesOmitted,
      attachments,
      conversationIds: ids,
      storeName: organization.name,
      generatedAt,
    };
  }

  private async loadTakeovers(organizationId: string, ids: string[]): Promise<SourceTakeover[]> {
    const events = await AppDataSource.getRepository(ConversationTakeoverEvent).find({
      where: { conversation_id: In(ids), organization_id: organizationId },
      order: { started_at: "ASC" },
    });
    const userIds = [...new Set(events.map((e) => e.user_id))];
    const users = userIds.length
      ? await AppDataSource.getRepository(User).find({
          where: { id: In(userIds) },
          select: { id: true, firstName: true },
        })
      : [];
    const firstNames = new Map(users.map((u) => [u.id, u.firstName ?? null]));
    return events.map((e) => ({
      conversation_id: e.conversation_id,
      started_at: e.started_at,
      ended_at: e.ended_at,
      // First name only: enough to show a person stepped in.
      userName: firstNames.get(e.user_id) ?? null,
    }));
  }

  /** Attachment files still stored for this org, read through storageService. */
  private async loadAttachments(
    organizationId: string,
    entries: ReturnType<typeof buildTimeline>["entries"],
  ): Promise<StoredAttachment[]> {
    const stored: StoredAttachment[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.kind !== "message") continue;
      for (const attachment of entry.attachments) {
        if (!attachment?.id || seen.has(attachment.id) || !UUID.test(attachment.id)) continue;
        seen.add(attachment.id);
        try {
          const { buffer, upload } = await storageService.download(attachment.id);
          if (upload.organizationId !== organizationId) continue;
          stored.push({
            conversationId: entry.conversationId,
            attachment,
            buffer,
            mimeType: upload.mimeType,
          });
        } catch (err) {
          logger.debug({ err, attachmentId: attachment.id }, "Attachment no longer stored");
        }
      }
    }
    return stored;
  }

  private async prepareImages(
    images: StoredAttachment[],
    pass: { maxPx: number; quality: number } | null,
  ): Promise<Map<string, PreparedImage>> {
    const prepared = new Map<string, PreparedImage>();
    for (const image of images) {
      if (!pass) {
        prepared.set(image.attachment.id, { kind: "omitted" });
        continue;
      }
      try {
        const buffer = await sharp(image.buffer, { failOn: "none" })
          .rotate()
          .resize({
            width: pass.maxPx,
            height: pass.maxPx,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: pass.quality })
          .toBuffer();
        prepared.set(image.attachment.id, { kind: "image", buffer });
      } catch (err) {
        logger.debug({ err, attachmentId: image.attachment.id }, "Could not prepare image");
        prepared.set(image.attachment.id, { kind: "unavailable" });
      }
    }
    return prepared;
  }

  private async loadPolicyExcerpts(
    organizationId: string,
    documentIds: string[],
  ): Promise<Map<string, string>> {
    const ids = documentIds.filter((id) => UUID.test(id));
    if (ids.length === 0) return new Map();
    const documents = await AppDataSource.getRepository(Document).find({
      where: { id: In(ids), organizationId },
      select: { id: true, content: true, description: true },
    });
    return new Map(
      documents.map((d) => [
        d.id,
        (d.content || d.description || "").replace(/\s+/g, " ").trim().slice(0, 1500),
      ]),
    );
  }
}

export const disputeEvidenceService = new DisputeEvidenceService();

/**
 * Product-problem cases (D8-14): the evidence checklist and the "case complete"
 * state, kept on the conversation's metadata (`metadata.productCase`).
 *
 * Evidence: photos of the problem/product, the lot or batch number, an invoice
 * (receipt, nota fiscal or its number), how the product was used, and a
 * timeline. Photos, lot and invoice numbers can come from what the vision
 * pass read (D8-11); how-used and timeline come from the AI's summary of the
 * conversation.
 *
 * @module services/product-case/product-case
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import {
  MessageType,
  type Message,
  type MessageAttachment,
} from "@server/database/entities/message.entity";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { READABLE_IMAGE_TYPES } from "@server/services/media-analysis/readable";
import { redactCardNumbers } from "@server/services/media-analysis/redact";

export const EVIDENCE_ITEMS = ["photos", "lot_number", "invoice", "how_used", "timeline"] as const;
export type EvidenceItem = (typeof EVIDENCE_ITEMS)[number];

export interface ProductCaseEvidence {
  /** Customer photos of the problem or product (never withheld ID/card images). */
  photoIds: string[];
  lotNumber: string;
  /** The invoice file, its number, or both. */
  invoiceAttachmentId: string | null;
  invoiceNumber: string | null;
  howUsed: string;
  timeline: string;
}

export interface ProductCaseForward {
  status: "sent" | "failed" | "not_configured";
  to?: string;
  at: string;
  error?: string;
}

export interface ProductCase {
  status: "complete";
  completedAt: string;
  /** Short summary written by the AI for the merchant. */
  summary: string;
  product: string | null;
  evidence: ProductCaseEvidence;
  forward?: ProductCaseForward;
}

export interface ProductCaseInput {
  summary?: string;
  product?: string;
  lotNumber?: string;
  invoiceNumber?: string;
  howUsed?: string;
  timeline?: string;
}

/** `evidence` when every item is in, otherwise `missing`. */
export interface EvaluationResult {
  complete: boolean;
  evidence?: ProductCaseEvidence;
  missing?: EvidenceItem[];
}

function clean(value: string | undefined, max = 1000): string {
  return redactCardNumbers((value ?? "").trim()).slice(0, max);
}

function customerFiles(messages: Message[]): MessageAttachment[] {
  return messages
    .filter((message) => message.type === MessageType.CUSTOMER)
    .flatMap((message) => message.attachments ?? []);
}

/** A photo that shows the problem or the product (or any photo the AI could not classify). */
function isEvidencePhoto(attachment: MessageAttachment): boolean {
  if (!READABLE_IMAGE_TYPES.has(attachment.type)) return false;
  const analysis = attachment.analysis;
  if (analysis?.withheld) return false;
  if (analysis?.status !== "done") return true;
  return analysis.class === "damage" || analysis.class === "product" || analysis.class === "other";
}

/** Check the checklist against the conversation's files and the AI's input. */
export function evaluateProductCase(messages: Message[], input: ProductCaseInput): EvaluationResult {
  const files = customerFiles(messages);
  const readFields = files
    .filter((file) => file.analysis?.status === "done" && !file.analysis.withheld)
    .map((file) => file.analysis?.fields ?? {});

  const photoIds = files.filter(isEvidencePhoto).map((file) => file.id);
  const lotNumber =
    clean(input.lotNumber, 100) || readFields.find((fields) => fields.lot_number)?.lot_number || "";
  const invoiceFile = files.find(
    (file) => file.analysis?.status === "done" && file.analysis.class === "receipt",
  );
  const invoiceNumber =
    clean(input.invoiceNumber, 100) ||
    readFields.find((fields) => fields.invoice_number)?.invoice_number ||
    null;
  const howUsed = clean(input.howUsed);
  const timeline = clean(input.timeline);

  const missing: EvidenceItem[] = [];
  if (!photoIds.length) missing.push("photos");
  if (!lotNumber) missing.push("lot_number");
  if (!invoiceFile && !invoiceNumber) missing.push("invoice");
  if (!howUsed) missing.push("how_used");
  if (!timeline) missing.push("timeline");
  if (missing.length) return { complete: false, missing };

  return {
    complete: true,
    evidence: {
      photoIds,
      lotNumber,
      invoiceAttachmentId: invoiceFile?.id ?? null,
      invoiceNumber,
      howUsed,
      timeline,
    },
  };
}

export function readProductCase(conversation: Pick<Conversation, "metadata">): ProductCase | null {
  const value = conversation.metadata?.productCase;
  return value && typeof value === "object" ? (value as ProductCase) : null;
}

/** Merge into the conversation's current metadata (re-read) and broadcast the change. */
export async function saveProductCase(
  conversationId: string,
  organizationId: string,
  productCase: ProductCase,
): Promise<void> {
  const fresh = await conversationRepository.findById(conversationId);
  if (!fresh || fresh.organization_id !== organizationId) return;
  await conversationRepository.update(conversationId, organizationId, {
    metadata: { ...(fresh.metadata ?? {}), productCase },
  });
}

/** Build the complete case from a passing evaluation. */
export function buildProductCase(
  input: ProductCaseInput,
  evidence: ProductCaseEvidence,
  now = new Date(),
): ProductCase {
  return {
    status: "complete",
    completedAt: now.toISOString(),
    summary: clean(input.summary, 2000),
    product: clean(input.product, 200) || null,
    evidence,
  };
}

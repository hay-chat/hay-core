/**
 * Sends a complete product-problem case to the merchant (D8-15): one email to
 * the address the merchant configured (Settings > Customer privacy), with the
 * AI's summary, the evidence, and signed links to the photos and invoice.
 * Without a configured address nothing is sent; the case still shows in the
 * Inbox. The outcome is stored on the case (`productCase.forward`).
 *
 * Withheld ID/card images (D8-12) and documents the virus scan has not
 * cleared (D8-4) are never linked.
 *
 * @module services/product-case/forward
 */

import { z } from "zod";
import { getDashboardUrl } from "@server/config/env";
import type { MessageAttachment } from "@server/database/entities/message.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { createLogger } from "@server/lib/logger";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { organizationRepository } from "@server/repositories/organization.repository";
import { resolveMediaSettings } from "@server/types/organization-settings.types";
import { HANDOFF_SIGNED_URL_TTL_SECONDS, signMediaUrl } from "@server/services/media-url.service";
import { organizationNotificationLocale } from "@server/services/notification-locale";
import {
  readProductCase,
  saveProductCase,
  type ProductCase,
  type ProductCaseForward,
} from "./product-case";

const logger = createLogger("product-case-forward");

const emailSchema = z.string().trim().email().max(254);

type CopyLocale = "en" | "pt-BR";

const COPY: Record<
  CopyLocale,
  {
    subject: (product: string) => string;
    title: string;
    message: string;
    product: string;
    lot: string;
    invoice: string;
    invoiceFile: string;
    howUsed: string;
    timeline: string;
    photo: (n: number) => string;
    button: string;
    footer: string;
    unknownProduct: string;
  }
> = {
  en: {
    subject: (product) => `Product problem case: ${product}`,
    title: "A product problem case is complete",
    message: "Hay.chat collected the evidence for a product problem reported by a customer.",
    product: "Product",
    lot: "Lot / batch",
    invoice: "Invoice number",
    invoiceFile: "Invoice",
    howUsed: "How it was used",
    timeline: "Timeline",
    photo: (n) => `Photo ${n}`,
    button: "Open the conversation",
    footer:
      "File links expire in 7 days. You get this email because this address is set for product cases in Hay.chat.",
    unknownProduct: "product not named",
  },
  "pt-BR": {
    subject: (product) => `Caso de problema com produto: ${product}`,
    title: "Um caso de problema com produto está completo",
    message: "O Hay.chat reuniu as evidências de um problema com produto relatado por um cliente.",
    product: "Produto",
    lot: "Lote",
    invoice: "Número da nota",
    invoiceFile: "Nota fiscal",
    howUsed: "Como foi usado",
    timeline: "Linha do tempo",
    photo: (n) => `Foto ${n}`,
    button: "Abrir a conversa",
    footer:
      "Os links dos arquivos expiram em 7 dias. Você recebe este e-mail porque este endereço está definido para casos de produto no Hay.chat.",
    unknownProduct: "produto não informado",
  },
};

/** The configured case address, or null when none or invalid. */
export function validCaseEmail(value: string | null | undefined): string | null {
  const parsed = emailSchema.safeParse(value ?? "");
  return parsed.success ? parsed.data : null;
}

/** Never link withheld ID/card images (D8-12) or documents the virus scan holds (D8-4). */
function linkable(attachment: MessageAttachment | undefined): attachment is MessageAttachment {
  if (!attachment || attachment.analysis?.withheld) return false;
  return attachment.scan === undefined || attachment.scan === "clean";
}

/**
 * Email the case to the merchant's configured address and record the outcome.
 * Returns the forward record; never throws.
 */
export async function forwardProductCase(
  conversationId: string,
  organizationId: string,
): Promise<ProductCaseForward | null> {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation || conversation.organization_id !== organizationId) return null;
  const productCase = readProductCase(conversation);
  if (productCase?.status !== "complete") return null;

  const organization = await organizationRepository.findById(organizationId);
  const to = validCaseEmail(resolveMediaSettings(organization?.settings).caseEmail);
  const at = new Date().toISOString();

  let forward: ProductCaseForward;
  if (!to) {
    forward = { status: "not_configured", at };
  } else {
    forward = await sendCaseEmail(conversation.id, organizationId, productCase, to, at);
  }

  await saveProductCase(conversation.id, organizationId, { ...productCase, forward });
  return forward;
}

async function sendCaseEmail(
  conversationId: string,
  organizationId: string,
  productCase: ProductCase,
  to: string,
  at: string,
): Promise<ProductCaseForward> {
  try {
    const conversation = await conversationRepository.findById(conversationId);
    const messages = (await conversation?.getMessages()) ?? [];
    const files = new Map(
      messages
        .filter((message) => message.type === MessageType.CUSTOMER)
        .flatMap((message) => message.attachments ?? [])
        .map((attachment) => [attachment.id, attachment] as const),
    );

    const locale: CopyLocale =
      (await organizationNotificationLocale(organizationId)) === "pt-BR" ? "pt-BR" : "en";
    const copy = COPY[locale];
    const { evidence } = productCase;

    const relatedItems = evidence.photoIds
      .map((id) => files.get(id))
      .filter(linkable)
      .map((file, index) => ({
        text: copy.photo(index + 1),
        url: signMediaUrl(file.id, HANDOFF_SIGNED_URL_TTL_SECONDS),
      }));
    const invoiceFile = evidence.invoiceAttachmentId
      ? files.get(evidence.invoiceAttachmentId)
      : undefined;
    if (linkable(invoiceFile)) {
      relatedItems.push({
        text: copy.invoiceFile,
        url: signMediaUrl(invoiceFile.id, HANDOFF_SIGNED_URL_TTL_SECONDS),
      });
    }

    const details = [
      { label: copy.product, value: productCase.product ?? copy.unknownProduct },
      { label: copy.lot, value: evidence.lotNumber },
      ...(evidence.invoiceNumber ? [{ label: copy.invoice, value: evidence.invoiceNumber }] : []),
      { label: copy.howUsed, value: evidence.howUsed },
      { label: copy.timeline, value: evidence.timeline },
    ];

    const { emailService } = await import("@server/services/email.service");
    const result = await emailService.sendTemplateEmail({
      to,
      subject: copy.subject(productCase.product ?? copy.unknownProduct),
      template: "notification",
      locale,
      variables: {
        companyName: "Hay.chat",
        notificationTitle: copy.title,
        notificationMessage: productCase.summary ? `${copy.message}\n\n${productCase.summary}` : copy.message,
        details,
        relatedItems,
        actionButton: {
          url: `${getDashboardUrl()}/conversations/${conversationId}?org=${organizationId}`,
          text: copy.button,
        },
        additionalInfo: copy.footer,
      },
    });
    if (!result.success) return { status: "failed", to, at, error: result.error ?? "send failed" };
    return { status: "sent", to, at };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ conversationId, error: message }, "Could not forward the product case");
    return { status: "failed", to, at, error: message };
  }
}

/** Forward without blocking the AI turn. */
export function scheduleProductCaseForward(conversationId: string, organizationId: string): void {
  void forwardProductCase(conversationId, organizationId).catch((error) => {
    logger.error({ err: error, conversationId }, "Product case forward crashed");
  });
}

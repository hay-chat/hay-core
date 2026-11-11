import PDFDocument from "pdfkit";
import { csvCell } from "@server/lib/csv";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";
import { formatZonedDateTime, safeTimeZone } from "@server/utils/zoned-datetime";
import { createLogger } from "@server/lib/logger";
import { languageName, normalizeLanguage, type LanguageCode } from "@server/types/language.types";
import { translationService } from "./translation.service";

const logger = createLogger("conversation-export");

/** Messages an export shows translated: what the customer, the AI and the team wrote. */
const TRANSLATABLE_TYPES: readonly MessageType[] = [
  MessageType.CUSTOMER,
  MessageType.BOT_AGENT,
  MessageType.HUMAN_AGENT,
];

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  [MessageType.CUSTOMER]: "Customer",
  [MessageType.SYSTEM]: "System",
  [MessageType.HUMAN_AGENT]: "Human Agent",
  [MessageType.BOT_AGENT]: "Bot Agent",
  [MessageType.TOOL]: "Tool",
  [MessageType.DOCUMENT]: "Document",
  [MessageType.PLAYBOOK]: "Playbook",
  [MessageType.PRODUCT_RECOMMENDATION]: "Product Recommendation",
  [MessageType.FORM]: "Form",
};

/**
 * Messages in a reader's language, next to the record. `content` stays what
 * the customer saw; these are the reader's copies by message id.
 */
export interface ExportTranslation {
  language: LanguageCode;
  texts: Map<string, string>;
}

export interface PdfExportOptions {
  /** The organization's name, shown as the store in the header. */
  storeName: string;
  /** IANA zone every timestamp is shown in (the organization's time zone). */
  timeZone: string;
  /** Shown under each message, labelled, when it differs from the original. */
  translation?: ExportTranslation;
}

export class ConversationExportService {
  /**
   * The conversation's customer, AI and team messages in `language`. Stored
   * translations are reused; the rest are translated and stored on their
   * message, as the inbox does. `complete` is false when translating failed:
   * the export still goes out, with what was already stored.
   */
  async translate(
    conversation: Conversation,
    language: LanguageCode,
  ): Promise<{ translation: ExportTranslation; complete: boolean }> {
    const texts = new Map<string, string>();
    const missing: Message[] = [];
    for (const message of conversation.messages ?? []) {
      if (!TRANSLATABLE_TYPES.includes(message.type) || !message.content?.trim()) continue;
      const stored =
        normalizeLanguage(message.detectedLanguage) === language
          ? message.content
          : message.translations?.[language];
      if (stored) texts.set(message.id, stored);
      else missing.push(message);
    }

    let complete = true;
    if (missing.length) {
      try {
        const translated = await translationService.translateTexts({
          organizationId: conversation.organization_id,
          items: missing.map((message) => ({ id: message.id, text: message.content })),
          targetLanguage: language,
        });
        await Promise.all(
          missing.map((message) => {
            const result = translated.get(message.id)!;
            texts.set(message.id, result.text);
            return translationService.saveMessageTranslation({
              messageId: message.id,
              language,
              text: result.text,
              detectedLanguage: result.sourceLanguage,
            });
          }),
        );
      } catch (error) {
        complete = false;
        logger.error(
          { err: error, conversationId: conversation.id, language },
          "Export translation failed; exporting stored translations only",
        );
      }
    }
    return { translation: { language, texts }, complete };
  }

  async generatePdf(conversation: Conversation, options: PdfExportOptions): Promise<Buffer> {
    const timeZone = safeTimeZone(options.timeZone);
    const at = (date: Date | string | null | undefined) => formatZonedDateTime(date, timeZone);
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // --- Header ---
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text(conversation.title || "Conversation Transcript");
      doc.moveDown(0.5);

      doc.fontSize(10).font("Helvetica");
      if (options.storeName) doc.text(`Store: ${options.storeName}`);
      doc.text(`ID: ${conversation.id}`);
      doc.text(`Channel: ${conversation.channel}`);
      doc.text(`Status: ${conversation.status}`);
      if (conversation.language) {
        doc.text(`Language: ${conversation.language}`);
      }
      doc.text(`Created: ${at(conversation.created_at)}`);
      if (conversation.ended_at) {
        doc.text(`Ended: ${at(conversation.ended_at)}`);
      }
      if (conversation.closed_at) {
        doc.text(`Closed: ${at(conversation.closed_at)}`);
      }

      if (conversation.customer) {
        const parts = [
          conversation.customer.name,
          conversation.customer.email,
          conversation.customer.phone,
        ].filter(Boolean);
        if (parts.length > 0) {
          doc.text(`Customer: ${parts.join(" | ")}`);
        }
      }

      doc.text(`Times shown in: ${timeZone}`);

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // --- Messages ---
      const messages = conversation.messages || [];
      if (messages.length === 0) {
        doc.fontSize(10).font("Helvetica-Oblique").text("No messages in this conversation.");
      }

      for (const message of messages) {
        const timestamp = at(message.created_at);
        const label = this.getMessageLabel(message);

        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(`[${timestamp}] ${label}`, { continued: false });
        doc
          .font("Helvetica")
          .fontSize(10)
          .text(message.content || "", { indent: 10 });

        const translated = options.translation?.texts.get(message.id);
        if (translated && translated !== message.content) {
          doc
            .font("Helvetica-Oblique")
            .fontSize(8)
            .fillColor("#555555")
            .text(`Translation (${languageName(options.translation!.language)}):`, { indent: 10 })
            .font("Helvetica")
            .fontSize(10)
            .text(translated, { indent: 10 })
            .fillColor("black");
        }

        if (message.metadata?.toolName) {
          doc
            .font("Helvetica-Oblique")
            .fontSize(8)
            .text(`Tool: ${message.metadata.toolName}`, { indent: 10 });
        }

        if (message.attachments?.length) {
          for (const att of message.attachments) {
            doc
              .font("Helvetica")
              .fontSize(8)
              .text(`Attachment: ${att.name} (${att.type})`, { indent: 10 });
          }
        }

        doc.moveDown(0.4);
      }

      doc.end();
    });
  }

  /** With `translation`, a `translated_content` column follows `content`. */
  generateCsv(conversation: Conversation, translation?: ExportTranslation): string {
    const headers = [
      "conversation_id",
      "conversation_title",
      "channel",
      "status",
      "language",
      "conversation_created_at",
      "conversation_ended_at",
      "customer_name",
      "customer_email",
      "customer_phone",
      "message_id",
      "message_type",
      "direction",
      "sender",
      "content",
      ...(translation ? ["translated_content"] : []),
      "sentiment",
      "intent",
      "detected_language",
      "message_status",
      "message_created_at",
      "model",
      "tokens_used",
      "latency_ms",
      "confidence",
      "tool_name",
      "attachments_count",
    ];

    const messages = conversation.messages || [];
    const rows = messages.map((msg) =>
      [
        conversation.id,
        conversation.title || "",
        conversation.channel,
        conversation.status,
        conversation.language || "",
        conversation.created_at?.toISOString() || "",
        conversation.ended_at?.toISOString() || "",
        conversation.customer?.name || "",
        conversation.customer?.email || "",
        conversation.customer?.phone || "",
        msg.id,
        msg.type,
        msg.direction,
        msg.sender || "",
        msg.content || "",
        ...(translation ? [translation.texts.get(msg.id) ?? ""] : []),
        msg.sentiment || "",
        msg.intent || "",
        msg.detectedLanguage || "",
        msg.status,
        msg.created_at?.toISOString() || "",
        msg.metadata?.model || "",
        msg.metadata?.total_tokens?.toString() || "",
        msg.metadata?.latency_ms?.toString() || "",
        msg.metadata?.confidence?.toString() || "",
        msg.metadata?.toolName || "",
        (msg.attachments?.length || 0).toString(),
      ].map((v) => csvCell(v)),
    );

    // UTF-8 BOM for Excel compatibility
    const bom = "\uFEFF";
    return bom + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  private getMessageLabel(message: Message): string {
    const typeLabel = MESSAGE_TYPE_LABELS[message.type] || message.type;
    if (message.sender) {
      return `${typeLabel} (${message.sender})`;
    }
    return typeLabel;
  }
}

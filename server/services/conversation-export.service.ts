import PDFDocument from "pdfkit";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message, MessageType } from "@server/database/entities/message.entity";

const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  [MessageType.CUSTOMER]: "Customer",
  [MessageType.SYSTEM]: "System",
  [MessageType.HUMAN_AGENT]: "Human Agent",
  [MessageType.BOT_AGENT]: "Bot Agent",
  [MessageType.TOOL]: "Tool",
  [MessageType.DOCUMENT]: "Document",
  [MessageType.PLAYBOOK]: "Playbook",
};

export class ConversationExportService {
  async generatePdf(conversation: Conversation): Promise<Buffer> {
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
      doc.text(`ID: ${conversation.id}`);
      doc.text(`Channel: ${conversation.channel}`);
      doc.text(`Status: ${conversation.status}`);
      if (conversation.language) {
        doc.text(`Language: ${conversation.language}`);
      }
      doc.text(`Created: ${this.formatDate(conversation.created_at)}`);
      if (conversation.ended_at) {
        doc.text(`Ended: ${this.formatDate(conversation.ended_at)}`);
      }
      if (conversation.closed_at) {
        doc.text(`Closed: ${this.formatDate(conversation.closed_at)}`);
      }

      if (conversation.agent?.name) {
        doc.text(`Agent: ${conversation.agent.name}`);
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

      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // --- Messages ---
      const messages = conversation.messages || [];
      if (messages.length === 0) {
        doc.fontSize(10).font("Helvetica-Oblique").text("No messages in this conversation.");
      }

      for (const message of messages) {
        const timestamp = this.formatTime(message.created_at);
        const label = this.getMessageLabel(message);

        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(`[${timestamp}] ${label}`, { continued: false });
        doc
          .font("Helvetica")
          .fontSize(10)
          .text(message.content || "", { indent: 10 });

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

  generateCsv(conversation: Conversation): string {
    const headers = [
      "conversation_id",
      "conversation_title",
      "channel",
      "status",
      "language",
      "conversation_created_at",
      "conversation_ended_at",
      "agent_name",
      "customer_name",
      "customer_email",
      "customer_phone",
      "message_id",
      "message_type",
      "direction",
      "sender",
      "content",
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
        conversation.agent?.name || "",
        conversation.customer?.name || "",
        conversation.customer?.email || "",
        conversation.customer?.phone || "",
        msg.id,
        msg.type,
        msg.direction,
        msg.sender || "",
        msg.content || "",
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
      ].map((v) => this.escapeCsvValue(v)),
    );

    // UTF-8 BOM for Excel compatibility
    const bom = "\uFEFF";
    return bom + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  private escapeCsvValue(value: string): string {
    if (
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private formatDate(date: Date | string | null | undefined): string {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }

  private formatTime(date: Date | string | null | undefined): string {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().slice(11, 19);
  }

  private getMessageLabel(message: Message): string {
    const typeLabel = MESSAGE_TYPE_LABELS[message.type] || message.type;
    if (message.sender) {
      return `${typeLabel} (${message.sender})`;
    }
    return typeLabel;
  }
}

/**
 * Dispute evidence for a conversation not in English: the original stays
 * verbatim and a labelled English translation follows it (card networks read
 * evidence in English).
 */
import { describe, it, expect } from "@jest/globals";
import { MessageStatus, MessageType } from "../../database/entities/message.entity";
import { DeliveryState } from "../../types/message-feedback.types";
import { buildTimeline, type SourceConversation } from "../../services/dispute-evidence/timeline";
import { renderEvidencePdf } from "../../services/dispute-evidence/pdf-renderer";
import { pdfText } from "../helpers/pdf-text";

const conversation: SourceConversation = {
  id: "conv-1",
  channel: "web",
  created_at: new Date("2026-10-01T10:00:00Z"),
  messages: [
    {
      id: "m1",
      type: MessageType.CUSTOMER,
      content: "Meu cartão 4111 1111 1111 1111 foi cobrado duas vezes",
      englishTranslation: "My card 4111 1111 1111 1111 was charged twice",
      created_at: new Date("2026-10-01T10:00:00Z"),
    },
    {
      id: "m2",
      type: MessageType.BOT_AGENT,
      content: "Already in English.",
      englishTranslation: "Already in English.",
      status: MessageStatus.APPROVED,
      deliveryState: DeliveryState.SENT,
      created_at: new Date("2026-10-01T10:00:05Z"),
    },
  ],
};

function timeline(locale: "en" | "pt-BR") {
  return buildTimeline({
    conversations: [conversation],
    actionLogs: [],
    takeovers: [],
    template: "generic",
    locale,
    timeZone: "UTC",
  });
}

describe("dispute evidence English translation", () => {
  it("keeps the original verbatim and adds the masked English text", () => {
    const [customer, reply] = timeline("en").entries;
    expect(customer).toMatchObject({
      kind: "message",
      text: "Meu cartão [card number removed] foi cobrado duas vezes",
      translation: "My card [card number removed] was charged twice",
    });
    // Same text as the original: nothing to add.
    expect(reply).toMatchObject({ kind: "message", translation: null });
  });

  it("labels the translation in the PDF, in English for the card network", async () => {
    const pdf = await renderEvidencePdf({
      locale: "pt-BR",
      timeZone: "UTC",
      generatedAt: new Date("2026-10-20T12:00:00Z"),
      template: "generic",
      storeName: "Loja",
      order: null,
      customer: null,
      conversations: [{ id: "conv-1", channel: "web", created_at: conversation.created_at }],
      timeline: timeline("pt-BR"),
      policyExcerpts: new Map(),
      images: new Map(),
    });
    const text = pdfText(pdf);
    const original = text.indexOf("Meu cartão [número de cartão removido] foi cobrado duas vezes");
    const label = text.indexOf("Tradução para o inglês (English translation):");
    const english = text.indexOf("My card [número de cartão removido] was charged twice");
    expect(original).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(original);
    expect(english).toBeGreaterThan(label);
  });
});

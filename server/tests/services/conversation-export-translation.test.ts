/**
 * Conversation export with the reader's translation: `content` stays the
 * record; the CSV gains a `translated_content` column and the PDF shows a
 * labelled translation under each message. Missing translations are made
 * and stored like the inbox does; a failure still exports.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockTranslateTexts =
  jest.fn<
    (input: {
      items: Array<{ id: string; text: string }>;
      targetLanguage: string;
    }) => Promise<Map<string, { sourceLanguage: string | null; text: string }>>
  >();
const mockSaveMessageTranslation = jest.fn<(params: Record<string, unknown>) => Promise<void>>();
jest.mock("@server/services/translation.service", () => ({
  translationService: {
    translateTexts: mockTranslateTexts,
    saveMessageTranslation: mockSaveMessageTranslation,
  },
}));

import { pdfText } from "../helpers/pdf-text";
import { ConversationExportService } from "../../services/conversation-export.service";
import type { Conversation } from "../../database/entities/conversation.entity";
import { MessageType, type Message } from "../../database/entities/message.entity";

const conversation = () =>
  ({
    id: "c1",
    organization_id: "org-1",
    title: "Pedido",
    channel: "web",
    status: "open",
    language: "pt",
    created_at: new Date("2026-10-10T09:00:00Z"),
    ended_at: null,
    closed_at: null,
    customer: null,
    messages: [
      {
        id: "m1",
        type: MessageType.CUSTOMER,
        content: "Onde está meu pedido?",
        detectedLanguage: "pt",
        translations: { en: "Where is my order?" },
        created_at: new Date("2026-10-10T09:00:00Z"),
        metadata: null,
        attachments: [],
      },
      {
        id: "m2",
        type: MessageType.BOT_AGENT,
        content: "Foi entregue ontem.",
        detectedLanguage: "pt",
        translations: null,
        created_at: new Date("2026-10-10T09:00:05Z"),
        metadata: null,
        attachments: [],
      },
      {
        id: "m3",
        type: MessageType.TOOL,
        content: "{}",
        created_at: new Date("2026-10-10T09:00:03Z"),
        metadata: { toolName: "track" },
        attachments: [],
      },
    ] as unknown as Message[],
  }) as unknown as Conversation;

const service = new ConversationExportService();

describe("ConversationExportService translation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTranslateTexts.mockImplementation(
      async ({ items }) =>
        new Map(
          items.map((item) => [item.id, { sourceLanguage: "pt", text: "It was delivered." }]),
        ),
    );
  });

  it("reuses stored translations, translates and stores the rest", async () => {
    const { translation, complete } = await service.translate(conversation(), "en");

    expect(complete).toBe(true);
    expect(mockTranslateTexts).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ id: "m2", text: "Foi entregue ontem." }],
        targetLanguage: "en",
      }),
    );
    expect(mockSaveMessageTranslation).toHaveBeenCalledWith({
      messageId: "m2",
      language: "en",
      text: "It was delivered.",
      detectedLanguage: "pt",
    });
    expect([...translation.texts]).toEqual([
      ["m1", "Where is my order?"],
      ["m2", "It was delivered."],
    ]);
  });

  it("still exports the stored translations when translating fails", async () => {
    mockTranslateTexts.mockRejectedValue(new Error("LLM down"));

    const { translation, complete } = await service.translate(conversation(), "en");

    expect(complete).toBe(false);
    expect([...translation.texts]).toEqual([["m1", "Where is my order?"]]);
  });

  it("adds a translated_content column after content in the CSV", async () => {
    const { translation } = await service.translate(conversation(), "en");
    const [header, first, second, tool] = service
      .generateCsv(conversation(), translation)
      .replace(/^\uFEFF/, "")
      .split("\n");
    const columns = header.split(",");

    expect(columns.indexOf("translated_content")).toBe(columns.indexOf("content") + 1);
    expect(first).toContain("Onde está meu pedido?,Where is my order?");
    expect(second).toContain("Foi entregue ontem.,It was delivered.");
    expect(tool).toContain("{},,");
  });

  it("leaves the CSV unchanged without a translation", () => {
    expect(service.generateCsv(conversation())).not.toContain("translated_content");
  });

  it("shows a labelled translation under each message in the PDF", async () => {
    const { translation } = await service.translate(conversation(), "en");
    const text = pdfText(
      await service.generatePdf(conversation(), {
        storeName: "Loja",
        timeZone: "UTC",
        translation,
      }),
    );

    expect(text).toContain("Onde está meu pedido?");
    expect(text).toContain("Translation (English):");
    expect(text).toContain("Where is my order?");
    expect(text).toContain("It was delivered.");
  });
});

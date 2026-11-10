import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Multilingual inbox: `translateMessages` shows a conversation in the reader's
 * language, and `sendMessage` translates a person's reply into the customer's
 * language before it is stored (and so before channel delivery sends it).
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

type FakeMessage = {
  id: string;
  type: string;
  content: string;
  detectedLanguage: string | null;
  translations: Record<string, string> | null;
};
type FakeConversation = {
  id: string;
  organization_id: string;
  status: string;
  assigned_user_id: string | null;
  language: string | null;
  messages: FakeMessage[];
  addMessage: jest.Mock<(data: Record<string, unknown>) => Promise<FakeMessage>>;
};
let conversation: FakeConversation;

const mockConversationUpdate = jest.fn(
  async (_id: string, _organizationId: string, _data: Record<string, unknown>) => null,
);
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({
    findByIdAndOrganization: async () => conversation,
    update: mockConversationUpdate,
  })),
}));

let sender: { firstName: string; translationLanguage: string | null };
jest.mock("@server/repositories/user.repository", () => ({
  userRepository: { findById: async () => sender },
}));

type InvokeOptions = { history: string; prompt: string };
const mockInvoke = jest.fn<(options: InvokeOptions) => Promise<string>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: jest.fn(() => ({ invoke: mockInvoke })),
}));

const mockQuery = jest.fn<(sql: string, params: unknown[]) => Promise<unknown>>(async () => []);
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { query: mockQuery, getRepository: () => ({}) },
}));

import { conversationsRouter } from "@server/routes/v1/conversations";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const id = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

const ctx = {
  user: { id: USER_ID, hasScope: () => true, getRole: () => "owner" },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;
const caller = () => conversationsRouter.createCaller(ctx);

const message = (n: number, type: string, content: string, extra: Partial<FakeMessage> = {}) => ({
  id: id(n),
  type,
  content,
  detectedLanguage: null,
  translations: null,
  ...extra,
});

/** The LLM translates every item as `[target] text`, written in `source`. */
function llmAnswers(source: string) {
  mockInvoke.mockImplementation(async ({ history, prompt }) => {
    const target = /\(([a-zA-Z-]+)\)/.exec(prompt)![1];
    const items = JSON.parse(history).items as Array<{ id: string; text: string }>;
    return JSON.stringify({
      translations: items.map((item) => ({
        id: item.id,
        sourceLanguage: source,
        text: `[${target}] ${item.text}`,
      })),
    });
  });
}

const savedTranslations = () =>
  mockQuery.mock.calls
    .filter(([sql]) => sql.includes("UPDATE messages"))
    .map(([, params]) => params);

beforeEach(() => {
  jest.clearAllMocks();
  sender = { firstName: "Marina", translationLanguage: "nl" };
  conversation = {
    id: CONVERSATION_ID,
    organization_id: ORG_ID,
    status: "human-took-over",
    assigned_user_id: USER_ID,
    language: "en",
    messages: [],
    addMessage: jest.fn(async (data: Record<string, unknown>) => ({
      ...message(99, String(data.type), String(data.content)),
      translations: (data.translations as FakeMessage["translations"]) ?? null,
      detectedLanguage: (data.detectedLanguage as string | undefined) ?? null,
    })),
  };
});

describe("conversations.translateMessages", () => {
  it("reuses stored translations and translates and stores the rest", async () => {
    conversation.messages = [
      message(1, "Customer", "Where is my order?", {
        detectedLanguage: "en",
        translations: { nl: "Waar is mijn bestelling?" },
      }),
      message(2, "System", "internal"),
      message(3, "BotAgent", "It ships tomorrow."),
      message(4, "Customer", "Merci beaucoup pour votre aide rapide"),
    ];
    llmAnswers("fr");

    const result = await caller().translateMessages({
      conversationId: CONVERSATION_ID,
      language: "nl",
    });

    expect(result).toEqual([
      { messageId: id(1), text: "Waar is mijn bestelling?", sourceLanguage: "en" },
      { messageId: id(3), text: "[nl] It ships tomorrow.", sourceLanguage: "fr" },
      {
        messageId: id(4),
        text: "[nl] Merci beaucoup pour votre aide rapide",
        sourceLanguage: "fr",
      },
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const history = JSON.parse(mockInvoke.mock.calls[0][0].history);
    expect(history.items).toHaveLength(2);
    expect(history.context_do_not_translate).toContain("Customer: Where is my order?");
    expect(savedTranslations()).toEqual([
      [id(3), "nl", "[nl] It ships tomorrow.", "fr"],
      [id(4), "nl", "[nl] Merci beaucoup pour votre aide rapide", "fr"],
    ]);
    // The newest customer message is long enough to switch the conversation to French.
    expect(mockConversationUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
      language: "fr",
    });
  });

  it("limits the work to messageIds and skips messages already in the reader's language", async () => {
    conversation.messages = [
      message(1, "Customer", "Bonjour"),
      message(2, "HumanAgent", "Hallo", { detectedLanguage: "nl" }),
      message(3, "Customer", "ok"),
    ];
    llmAnswers("fr");

    const result = await caller().translateMessages({
      conversationId: CONVERSATION_ID,
      language: "nl",
      messageIds: [id(2), id(3)],
    });

    expect(result).toEqual([
      { messageId: id(2), text: "Hallo", sourceLanguage: "nl" },
      { messageId: id(3), text: "[nl] ok", sourceLanguage: "fr" },
    ]);
    expect(JSON.parse(mockInvoke.mock.calls[0][0].history).items).toHaveLength(1);
    // "ok" is too short to trust its detected language.
    expect(mockConversationUpdate).not.toHaveBeenCalled();
  });

  it("reports a failed translation and stores nothing", async () => {
    conversation.messages = [message(1, "Customer", "Bonjour")];
    mockInvoke.mockRejectedValue(new Error("provider down"));

    await expect(
      caller().translateMessages({ conversationId: CONVERSATION_ID, language: "nl" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "TRANSLATION_FAILED" });
    expect(savedTranslations()).toEqual([]);
  });

  it("refuses a language Hay doesn't know", async () => {
    await expect(
      caller().translateMessages({ conversationId: CONVERSATION_ID, language: "xx" as "nl" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("conversations.sendMessage translation", () => {
  const send = (input: Record<string, unknown> = {}) =>
    caller().sendMessage({
      conversationId: CONVERSATION_ID,
      content: "Uw pakket komt morgen",
      role: "assistant",
      ...input,
    });
  const stored = () => conversation.addMessage.mock.calls[0][0];

  it("stores and sends the reply in the customer's language, keeping the typed text", async () => {
    conversation.messages = [message(1, "Customer", "Where is it?", { detectedLanguage: "en" })];
    llmAnswers("nl");

    const result = await send();

    expect(stored().content).toBe("[en] Uw pakket komt morgen");
    expect(stored()).toMatchObject({
      translations: { nl: "Uw pakket komt morgen" },
      detectedLanguage: "en",
    });
    expect(result).toMatchObject({
      content: "[en] Uw pakket komt morgen",
      translations: { nl: "Uw pakket komt morgen" },
      detectedLanguage: "en",
    });
  });

  it("translates into an explicit target language", async () => {
    llmAnswers("nl");
    await send({ targetLanguage: "de" });
    expect(stored().content).toBe("[de] Uw pakket komt morgen");
  });

  it("sends as typed when the customer speaks the sender's language", async () => {
    conversation.language = "nl";
    await send();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(stored().content).toBe("Uw pakket komt morgen");
    expect(stored()).toMatchObject({
      translations: { nl: "Uw pakket komt morgen" },
      detectedLanguage: "nl",
    });
  });

  it("sends as typed when the person opts out", async () => {
    await send({ translate: false });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(stored().content).toBe("Uw pakket komt morgen");
    expect(stored().translations).toEqual({ nl: "Uw pakket komt morgen" });
    expect(stored().detectedLanguage).toBeUndefined();
  });

  it("doesn't translate for a person without a translation language", async () => {
    sender.translationLanguage = null;
    await send();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(stored().content).toBe("Uw pakket komt morgen");
    expect(stored().translations).toBeUndefined();
  });

  it("saves and sends nothing when the translation fails", async () => {
    mockInvoke.mockRejectedValue(new Error("provider down"));
    await expect(send()).rejects.toMatchObject({
      code: "UNPROCESSABLE_CONTENT",
      message: "TRANSLATION_FAILED",
    });
    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(savedTranslations()).toEqual([]);
  });
});

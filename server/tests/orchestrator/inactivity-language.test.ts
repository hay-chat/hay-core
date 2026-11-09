import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { MessageType, type Message } from "@server/database/entities/message.entity";

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockGetPrompt =
  jest.fn<(id: string, variables: Record<string, unknown>) => Promise<string>>();
const mockInvoke = jest.fn<() => Promise<string>>();

jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({
    findById: (id: string) => mockFindById(id),
    update: jest.fn(async () => undefined),
  })),
}));
jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => ({})),
}));
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: jest.fn(() => ({ invoke: () => mockInvoke() })),
}));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: {
    getInstance: () => ({
      getPrompt: (id: string, variables: Record<string, unknown>) => mockGetPrompt(id, variables),
    }),
  },
}));
jest.mock("@server/services/hooks/hook-manager", () => ({
  hookManager: { trigger: jest.fn(async () => undefined) },
}));
jest.mock("@server/orchestrator/reply-guard", () => ({
  getAiReplyBlocker: () => null,
  recheckAiReply: async () => null,
}));

import {
  closeInactiveConversation,
  sendInactivityWarning,
} from "@server/orchestrator/conversation-utils";

const customer = (content: string, detectedLanguage: string | null): Message =>
  ({ type: MessageType.CUSTOMER, content, detectedLanguage, metadata: {} }) as unknown as Message;
const bot = (content: string, metadata: Record<string, unknown> = {}): Message =>
  ({
    type: MessageType.BOT_AGENT,
    content,
    detectedLanguage: null,
    metadata,
  }) as unknown as Message;

function conversationWith(messages: Message[], language: string | null = null) {
  const conversation = {
    id: "conversation-1",
    organization_id: "org-1",
    status: "open",
    title: "Inviting a team",
    language,
    organization: { defaultLanguage: "en" },
    getMessages: async () => messages,
    addMessage: jest.fn(async (_message: { content: string }) => undefined),
  };
  mockFindById.mockResolvedValue(conversation);
  return conversation;
}

describe("inactivity messages follow the customer's language", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPrompt.mockResolvedValue("prompt");
    mockInvoke.mockResolvedValue("reply");
  });

  it("asks for the language the customer last wrote in, over the English defaults", async () => {
    conversationWith([bot("Hello!"), customer("Como convido minha equipe?", "pt"), bot("Claro")]);
    await sendInactivityWarning("conversation-1", "org-1");
    expect(mockGetPrompt.mock.calls[0][1].languageName).toBe("Portuguese");
  });

  it("uses the latest detected language when the customer switches", async () => {
    conversationWith([customer("Olá", "pt"), bot("Oi"), customer("Actually, English", "en")], "pt");
    await sendInactivityWarning("conversation-1", "org-1");
    expect(mockGetPrompt.mock.calls[0][1].languageName).toBe("English");
  });

  it("falls back to the conversation language when nothing was detected", async () => {
    conversationWith([customer("ok", null), bot("Oi")], "pt");
    await sendInactivityWarning("conversation-1", "org-1");
    expect(mockGetPrompt.mock.calls[0][1].languageName).toBe("Portuguese");
  });

  it("closes in the customer's language after a warning", async () => {
    const conversation = conversationWith([
      customer("Como convido minha equipe?", "pt"),
      bot("Ainda precisa de ajuda?", { isInactivityWarning: true }),
    ]);
    await closeInactiveConversation("conversation-1", "org-1", 1000);
    expect(conversation.addMessage.mock.calls[0][0].content).toMatch(/^Como não tive resposta/);
  });

  it("asks for the customer's language in a written close when no warning was sent", async () => {
    conversationWith([customer("Como convido minha equipe?", "pt"), bot("Claro")]);
    await closeInactiveConversation("conversation-1", "org-1", 1000);
    expect(mockGetPrompt.mock.calls[0][0]).toBe("conversation/closure-message");
    expect(mockGetPrompt.mock.calls[0][1].languageName).toBe("Portuguese");
  });

  it.each([
    "en/conversation/inactivity-check.md",
    "pt/conversation/inactivity-check.md",
    "en/conversation/closure-message.md",
    "pt/conversation/closure-message.md",
  ])("%s tells the model which language to write", (template) => {
    const text = fs.readFileSync(path.join(__dirname, "../../prompts", template), "utf8");
    expect(text).toContain("{{languageName}}");
  });
});

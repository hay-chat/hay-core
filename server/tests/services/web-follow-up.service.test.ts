import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockSendTemplateEmail =
  jest.fn<(options: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>>();
const mockConnected = jest.fn<(id: string) => number>();
const mockRedisSet = jest.fn<(...args: unknown[]) => Promise<string | null>>();

jest.mock("@server/database/data-source", () => ({ AppDataSource: { getRepository: () => ({}) } }));
jest.mock("@server/services/email.service", () => ({
  emailService: { sendTemplateEmail: (o: Record<string, unknown>) => mockSendTemplateEmail(o) },
}));
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { getConversationCount: (id: string) => mockConnected(id) },
}));
jest.mock("@server/services/redis.service", () => ({
  redisService: { getClient: () => ({ set: (...args: unknown[]) => mockRedisSet(...args) }) },
}));
jest.mock("@server/services/webchat/webchat-settings.service", () => {
  const actual = jest.requireActual<
    typeof import("@server/services/webchat/webchat-settings.service")
  >("@server/services/webchat/webchat-settings.service");
  return {
    matchesAllowedDomains: actual.matchesAllowedDomains,
    webchatSettingsService: { getSettings: async () => ({ allowedDomains: ["shop.com"] }) },
  };
});

import type { Conversation } from "@server/database/entities/conversation.entity";
import { emailHumanReplyIfAway, resumeUrl } from "@server/services/web-follow-up.service";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";

function conversation(overrides: Record<string, unknown> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    channel: "web",
    organization_id: "org-1",
    language: "pt",
    metadata: { url: "https://shop.com/products/shoe#reviews" },
    organization: { name: "Loja Azul" },
    customer: { email: "ana@example.com" },
    ...overrides,
  } as unknown as Conversation;
}

describe("resumeUrl", () => {
  it("links back to the chat page with the resume parameter", () => {
    expect(resumeUrl("https://shop.com/p?x=1#top", ["shop.com"], CONVERSATION_ID)).toBe(
      `https://shop.com/p?x=1&hay_conversation=${CONVERSATION_ID}`,
    );
  });

  it("never links to a host the org did not explicitly allow", () => {
    expect(resumeUrl("https://evil.com/p", ["shop.com"], CONVERSATION_ID)).toBeNull();
    expect(resumeUrl("https://evil.com/p", ["*"], CONVERSATION_ID)).toBeNull();
    expect(resumeUrl("javascript:alert(1)", ["shop.com"], CONVERSATION_ID)).toBeNull();
    expect(resumeUrl(undefined, ["shop.com"], CONVERSATION_ID)).toBeNull();
  });
});

describe("emailHumanReplyIfAway", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnected.mockReturnValue(0);
    mockRedisSet.mockResolvedValue("OK");
    mockSendTemplateEmail.mockResolvedValue({ success: true });
  });

  it("emails the reply in the shopper's language from the platform address", async () => {
    const sent = await emailHumanReplyIfAway(conversation(), {
      content: "Seu pedido sai amanhã.",
      sender: "Marta",
    });
    expect(sent).toBe(true);
    const options = mockSendTemplateEmail.mock.calls[0][0] as {
      to: string;
      locale: string;
      subject: string;
      from: { name: string };
      variables: Record<string, unknown>;
    };
    expect(options.to).toBe("ana@example.com");
    expect(options.locale).toBe("pt-BR");
    expect(options.subject).toBe("Loja Azul respondeu à sua mensagem");
    expect(options.from.name).toBe("Loja Azul");
    expect(options.variables.notificationMessage).toBe("Seu pedido sai amanhã.");
    expect(options.variables.actionButton).toEqual({
      url: `https://shop.com/products/shoe?hay_conversation=${CONVERSATION_ID}`,
      text: "Continuar a conversa",
    });
  });

  it("stays quiet while the shopper still has the chat open", async () => {
    mockConnected.mockReturnValue(1);
    expect(await emailHumanReplyIfAway(conversation(), { content: "Hi" })).toBe(false);
    expect(mockSendTemplateEmail).not.toHaveBeenCalled();
  });

  it("sends at most one email per throttle window", async () => {
    mockRedisSet.mockResolvedValue(null);
    expect(await emailHumanReplyIfAway(conversation(), { content: "Hi" })).toBe(false);
    expect(mockSendTemplateEmail).not.toHaveBeenCalled();
  });

  it("needs an email address and a web conversation", async () => {
    expect(
      await emailHumanReplyIfAway(conversation({ customer: { email: null } }), { content: "Hi" }),
    ).toBe(false);
    expect(
      await emailHumanReplyIfAway(conversation({ channel: "whatsapp" }), { content: "Hi" }),
    ).toBe(false);
    expect(mockSendTemplateEmail).not.toHaveBeenCalled();
  });
});

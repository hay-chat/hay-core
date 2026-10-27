import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "../../database/entities/agent.entity";
import { Customer } from "../../database/entities/customer.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ConversationService } from "../../services/conversation.service";

/**
 * Regression: a pt-BR shopper saw the widget's Portuguese placeholder
 * greeting replaced by the stored English one. The widget now sends its locale
 * on create; the conversation language is set from it and the greeting is
 * translated (with the org's LLM) before create returns.
 */

const mockInvoke = jest.fn<(args: { prompt: string; organizationId?: string }) => Promise<string>>();
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({ invoke: mockInvoke })),
}));
jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: jest.fn(async () => true) },
}));
jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
    broadcastMessageReceived: jest.fn(),
  },
}));
jest.mock("../../services/push-notification.service", () => ({
  pushNotificationService: { onConversationStatusChanged: jest.fn() },
}));
jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => true, publish: jest.fn() },
}));

const ORG_ID = "91ee0000-0000-4000-8000-000000000001";
const AGENT_ID = "91ee0000-0000-4000-8000-000000000002";
const ORG_GREETING = "Hello! How can I help you today?";

const conversationService = new ConversationService();

async function create(language?: string | null) {
  return conversationService.createConversation(ORG_ID, {
    status: "open",
    language,
    metadata: { channel: "web" },
  });
}

async function greetingOf(conversationId: string): Promise<Message> {
  const messages = await AppDataSource.getRepository(Message).find({
    where: { conversation_id: conversationId, type: MessageType.BOT_AGENT },
  });
  const greeting = messages.find(
    (m) => (m.metadata as Record<string, unknown> | null)?.isGreeting === true,
  );
  if (!greeting) throw new Error("no greeting written");
  return greeting;
}

beforeAll(async () => {
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  const orgRepo = AppDataSource.getRepository(Organization);
  if (!(await orgRepo.findOne({ where: { id: ORG_ID } }))) {
    await orgRepo.save(
      orgRepo.create({ id: ORG_ID, name: "Greeting Locale Org", slug: "greeting-locale-org" }),
    );
  }
  const agentRepo = AppDataSource.getRepository(Agent);
  if (!(await agentRepo.findOne({ where: { id: AGENT_ID } }))) {
    await agentRepo.save(
      agentRepo.create({
        id: AGENT_ID,
        name: "Greeting Agent",
        organization_id: ORG_ID,
        initialGreeting: ORG_GREETING,
      }),
    );
  }
  await orgRepo.update({ id: ORG_ID }, { defaultAgentId: AGENT_ID });
});

afterAll(async () => {
  await AppDataSource.getRepository(Conversation).delete({ organization_id: ORG_ID });
  await AppDataSource.getRepository(Customer).delete({ organization_id: ORG_ID });
  await AppDataSource.getRepository(Organization).update({ id: ORG_ID }, { defaultAgentId: null });
  await AppDataSource.getRepository(Agent).delete({ id: AGENT_ID });
  await AppDataSource.getRepository(Organization).delete({ id: ORG_ID });
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("create with the widget locale", () => {
  it("sets the language and writes the greeting translated with the org's LLM", async () => {
    mockInvoke.mockResolvedValue(" Olá! Como posso ajudar você hoje? ");

    const conversation = await create("pt-BR");

    const stored = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(stored.language).toBe("pt");
    expect((await greetingOf(conversation.id)).content).toBe("Olá! Como posso ajudar você hoje?");
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toMatchObject({ organizationId: ORG_ID });
    expect(mockInvoke.mock.calls[0][0].prompt).toContain(ORG_GREETING);
  });

  it("keeps the greeting as written when translation fails, and still creates", async () => {
    mockInvoke.mockRejectedValue(new Error("provider down"));

    const conversation = await create("pt-BR");

    expect((await greetingOf(conversation.id)).content).toBe(ORG_GREETING);
    expect(conversation.needs_processing).toBe(false);
  });

  it("does not translate an English widget", async () => {
    const conversation = await create("en-us");
    expect((await greetingOf(conversation.id)).content).toBe(ORG_GREETING);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("ignores an unsupported language", async () => {
    const conversation = await create("xx-YY");
    const stored = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(stored.language).toBeNull();
    expect((await greetingOf(conversation.id)).content).toBe(ORG_GREETING);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

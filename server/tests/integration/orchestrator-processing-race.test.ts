import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { Agent } from "../../database/entities/agent.entity";
import { Customer } from "../../database/entities/customer.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ConversationService } from "../../services/conversation.service";
import { conversationRepository } from "../../repositories/conversation.repository";
import { runConversation } from "../../orchestrator/run";

/**
 * Processing flags under concurrency, against the real test database.
 *
 * Bug A: the widget creates the conversation on the shopper's first message
 * and sends that message right away. The run started by the create could read
 * "no customer message", write the greeting after the shopper's message and
 * then clear needs_processing, so the first message was never answered.

 *
 * The LLM-backed layers are the boundary; locking, flags, messages and status
 * transitions are real. The queue is an in-memory list drained by the test,
 * standing in for the RabbitMQ worker.
 */

const queue: Array<{ conversationId: string; trigger: string }> = [];
jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: {
    enqueue: jest.fn(async (conversationId: string, _orgId: string, trigger: string) => {
      queue.push({ conversationId, trigger });
      return true;
    }),
  },
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
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({
    invoke: jest.fn(async () => "ok"),
    invokeWithMeta: jest.fn(),
  })),
}));
jest.mock("../../services/core/tool-execution.service", () => ({
  ToolExecutionService: class {
    handleToolExecution = jest.fn();
  },
}));
// The message the current run is answering, as handed to perception.
let mockPerceived: { content: string } | null = null;
jest.mock("../../orchestrator/perception.layer", () => ({
  PerceptionLayer: class {
    perceive = async (message: { content: string }) => {
      mockPerceived = message;
      return {
        intent: { label: "question", score: 0.9 },
        sentiment: { label: "neutral" },
        language: "en",
      };
    };
  },
}));
jest.mock("../../orchestrator/retrieval.layer", () => ({
  RetrievalLayer: class {
    getRelevantDocuments = async () => [];
  },
}));
jest.mock("../../orchestrator/conversation-utils", () => ({
  generateHandoffSummary: jest.fn(async () => undefined),
  generateConversationTitle: jest.fn(async () => undefined),
  validateConversationClosure: jest.fn(async () => ({ shouldClose: false })),
}));

// A stand-in planner: hands off when the shopper asks for a person, otherwise
// answers the message the run perceived.
jest.mock("../../orchestrator/execution.layer", () => ({
  ExecutionLayer: class {
    execute = async () => {
      if (mockPerceived?.content.includes("person")) {
        return { step: "HANDOFF", userMessage: null };
      }
      return { step: "RESPOND", userMessage: `Answer to: ${mockPerceived?.content}` };
    };
  },
}));

const ORG_ID = "7ace0000-0000-4000-8000-000000000001";
const AGENT_ID = "7ace0000-0000-4000-8000-000000000002";
const USER_ID = "7ace0000-0000-4000-8000-000000000003";

const conversationService = new ConversationService();

async function messagesOf(conversationId: string): Promise<Message[]> {
  return AppDataSource.getRepository(Message).find({
    where: { conversation_id: conversationId },
    order: { created_at: "ASC" },
  });
}

async function reload(conversationId: string): Promise<Conversation> {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) throw new Error("conversation vanished");
  return conversation;
}

/** Run every queued job (and the jobs they queue) like the worker would. */
async function drainQueue(): Promise<void> {
  for (let i = 0; queue.length > 0 && i < 20; i++) {
    const job = queue.shift()!;
    await runConversation(job.conversationId);
  }
}

async function shopperSays(conversationId: string, content: string): Promise<Message> {
  const conversation = await reload(conversationId);
  return conversation.addMessage({ content, type: MessageType.CUSTOMER });
}

/** What the public widget create does: an open web conversation. */
async function createWidgetConversation(): Promise<Conversation> {
  const conversation = await conversationService.createConversation(ORG_ID, {
    status: "open",
    metadata: { channel: "web" },
  });
  await conversationRepository.updateById(conversation.id, { channel: "web" });
  return conversation;
}

const isGreeting = (m: Message) =>
  m.type === MessageType.BOT_AGENT &&
  (m.metadata as Record<string, unknown> | null)?.isGreeting === true;
const replies = (messages: Message[]) =>
  messages.filter((m) => m.type === MessageType.BOT_AGENT && !isGreeting(m));

beforeAll(async () => {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  await AppDataSource.runMigrations();

  const orgRepo = AppDataSource.getRepository(Organization);
  if (!(await orgRepo.findOne({ where: { id: ORG_ID } }))) {
    await orgRepo.save(
      orgRepo.create({ id: ORG_ID, name: "Run Race Test Org", slug: "run-race-test-org" }),
    );
  }
  const agentRepo = AppDataSource.getRepository(Agent);
  if (!(await agentRepo.findOne({ where: { id: AGENT_ID } }))) {
    await agentRepo.save(
      agentRepo.create({ id: AGENT_ID, name: "Race Agent", organization_id: ORG_ID }),
    );
  }
  await orgRepo.update({ id: ORG_ID }, { defaultAgentId: AGENT_ID });
  const userRepo = AppDataSource.getRepository(User);
  if (!(await userRepo.findOne({ where: { id: USER_ID } }))) {
    await userRepo.save(
      userRepo.create({ id: USER_ID, email: "run-race-test@example.com", password: "x" }),
    );
  }
});

afterAll(async () => {
  await AppDataSource.getRepository(Conversation).delete({ organization_id: ORG_ID });
  await AppDataSource.getRepository(Customer).delete({ organization_id: ORG_ID });
  await AppDataSource.getRepository(Organization).update({ id: ORG_ID }, { defaultAgentId: null });
  await AppDataSource.getRepository(Agent).delete({ id: AGENT_ID });
  await AppDataSource.getRepository(User).delete({ id: USER_ID });
  await AppDataSource.getRepository(Organization).delete({ id: ORG_ID });
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

beforeEach(() => {
  queue.length = 0;
  jest.restoreAllMocks();
});

describe("Bug A: first widget message races the create-triggered run", () => {
  it("answers the first message and keeps the greeting before it", async () => {
    const created = await createWidgetConversation();

    // The shopper's message lands while a run for this conversation is in
    // flight and has already looked for a customer message (none yet). The
    // run that message triggers finds the conversation locked and bails.
    const realGetLast = conversationRepository.getLastHumanMessage.bind(conversationRepository);
    let interleaved = false;
    jest.spyOn(conversationRepository, "getLastHumanMessage").mockImplementation(async (id) => {
      const result = await realGetLast(id);
      if (!interleaved) {
        interleaved = true;
        await shopperSays(created.id, "Do you ship to Portugal?");
        // The worker takes the job that message queued; the run finds the lock.
        expect(queue.pop()).toMatchObject({ trigger: "customer_message" });
        await runConversation(created.id); // locked out
      }
      return result;
    });

    // The run started by the create (or by the sweep, if create queued none).
    queue.length = 0;
    await runConversation(created.id);
    jest.restoreAllMocks();
    expect(interleaved).toBe(true);

    await drainQueue();

    const messages = await messagesOf(created.id);
    const customerIndex = messages.findIndex((m) => m.type === MessageType.CUSTOMER);
    const greetings = messages.filter(isGreeting);
    expect(greetings).toHaveLength(1);
    expect(messages.indexOf(greetings[0])).toBeLessThan(customerIndex);

    const answers = replies(messages);
    expect(answers.map((m) => m.content)).toEqual(["Answer to: Do you ship to Portugal?"]);
    expect(messages.indexOf(answers[0])).toBeGreaterThan(customerIndex);

    const after = await reload(created.id);
    expect(after.needs_processing).toBe(false);
    expect(after.last_processed_at!.getTime()).toBeGreaterThanOrEqual(
      messages[customerIndex].created_at.getTime(),
    );
  });

  it("writes the greeting before create returns and queues no empty run", async () => {
    const created = await createWidgetConversation();

    const messages = await messagesOf(created.id);
    expect(messages.filter(isGreeting)).toHaveLength(1);
    expect(queue).toEqual([]);
    expect((await reload(created.id)).needs_processing).toBe(false);

    await shopperSays(created.id, "Hi there");
    await drainQueue();
    expect(replies(await messagesOf(created.id)).map((m) => m.content)).toEqual([
      "Answer to: Hi there",
    ]);
  });

  it("does not clear the flag for a message that arrived after the run read its input", async () => {
    const created = await createWidgetConversation();
    await shopperSays(created.id, "First question");

    // The second message arrives while the first is being answered.
    const realGetLast = conversationRepository.getLastHumanMessage.bind(conversationRepository);
    let interleaved = false;
    jest.spyOn(conversationRepository, "getLastHumanMessage").mockImplementation(async (id) => {
      const result = await realGetLast(id);
      if (!interleaved) {
        interleaved = true;
        await shopperSays(created.id, "Second question");
        // The worker takes the job that message queued; the run finds the lock.
        expect(queue.pop()).toMatchObject({ trigger: "customer_message" });
        await runConversation(created.id); // locked out
      }
      return result;
    });
    queue.length = 0;
    await runConversation(created.id);
    jest.restoreAllMocks();

    await drainQueue();

    expect(replies(await messagesOf(created.id)).map((m) => m.content)).toEqual([
      "Answer to: First question",
      "Answer to: Second question",
    ]);
    expect((await reload(created.id)).needs_processing).toBe(false);
  });
});

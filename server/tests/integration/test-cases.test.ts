import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageStatus, MessageType } from "../../database/entities/message.entity";
import { SimulationRunItem } from "../../database/entities/simulation-run-item.entity";

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
jest.mock("../../services/conversation-alert.service", () => ({
  conversationAlertService: {
    onConversationStatusChanged: jest.fn(),
    onCustomerMessage: jest.fn(),
  },
}));

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<string>>();
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({ invoke: mockInvoke })),
}));

import { testCaseService } from "../../services/simulation/test-case.service";
import { simulationHarnessService } from "../../services/simulation/simulation-harness.service";

const judge = (quality: "good" | "wrong") =>
  JSON.stringify({
    agreement: quality === "good" ? "same" : "different",
    quality,
    risky: false,
    knowledgeMissing: false,
    meetsExpectedOutcome: null,
    repeatsAvoidedReply: false,
    reasoning: "r",
  });

/** D7-12: test cases saved from approvals and replays, and the pre-publish regression. */
describe("test cases", () => {
  const orgId = "d7120000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Test case Org", slug: "d712-org" }));
    }
  });

  beforeEach(async () => {
    mockInvoke.mockReset();
    await AppDataSource.query(`DELETE FROM test_cases WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM test_cases WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  async function conversationWithReply(status: MessageStatus, originalContent: string | null) {
    const conversation = await AppDataSource.getRepository(Conversation).save({
      organization_id: orgId,
      title: "Refund",
      channel: "web",
      status: "open",
      context: {},
      metadata: {},
    });
    const base = Date.now() - 60_000;
    await AppDataSource.getRepository(Message).insert({
      conversation_id: conversation.id,
      content: "Can I get a refund for 1001?",
      type: MessageType.CUSTOMER,
      created_at: new Date(base),
    });
    const reply = await AppDataSource.getRepository(Message).save({
      conversation_id: conversation.id,
      content: "Refunds take 5 days once we receive the item.",
      originalContent,
      status,
      type: MessageType.BOT_AGENT,
      created_at: new Date(base + 1),
    });
    return reply;
  }

  it("saves an edited approval: the edit is the reference, the AI's draft is to avoid", async () => {
    const reply = await conversationWithReply(MessageStatus.EDITED, "Refund done!");
    const testCase = await testCaseService.createFromMessage(orgId, reply.id, {
      expectedOutcome: "Explains the return first",
    });
    expect(testCase.source).toBe("approval_edit");
    expect(testCase.seed).toEqual([{ role: "customer", text: "Can I get a refund for 1001?" }]);
    expect(testCase.expectations).toEqual({
      referenceReply: "Refunds take 5 days once we receive the item.",
      avoidReply: "Refund done!",
      expectedOutcome: "Explains the return first",
    });
    expect(testCase.title).toBe("Can I get a refund for 1001?");
  });

  it("saves a blocked reply as one to avoid, and refuses other organizations' messages", async () => {
    const reply = await conversationWithReply(MessageStatus.REJECTED, null);
    const testCase = await testCaseService.createFromMessage(orgId, reply.id);
    expect(testCase.source).toBe("approval_block");
    expect(testCase.expectations.avoidReply).toBe("Refunds take 5 days once we receive the item.");
    await expect(
      testCaseService.createFromMessage("d7120000-0000-4000-8000-0000000000ff", reply.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("runs the cases before publishing and flags the ones that passed before", async () => {
    const reply = await conversationWithReply(MessageStatus.EDITED, "Refund done!");
    const testCase = await testCaseService.createFromMessage(orgId, reply.id);

    async function runOnce(quality: "good" | "wrong") {
      mockInvoke.mockResolvedValue(judge(quality));
      const run = await testCaseService.startRegression({ organizationId: orgId });
      expect(run.kind).toBe("test_cases");
      const [item] = await AppDataSource.getRepository(SimulationRunItem).find({
        where: { run_id: run.id },
      });
      expect(item.source_ref).toBe(`test_case:${testCase.id}`);
      await simulationHarnessService.runItem(item.conversation_id!, async (conversationId) => {
        await AppDataSource.getRepository(Message).insert({
          conversation_id: conversationId,
          content: "Sure, refunded.",
          type: MessageType.BOT_AGENT,
        });
      });
      return testCaseService.regressionResults(orgId, run.id);
    }

    const first = await runOnce("good");
    expect(first.failing).toBe(0);
    expect(first.cases[0]).toMatchObject({ testCaseId: testCase.id, passed: true });

    const second = await runOnce("wrong");
    expect(second.failing).toBe(1);
    expect(second.newFailures).toBe(1);
    expect(second.cases[0]).toMatchObject({
      passed: false,
      previouslyPassed: true,
      newFailure: true,
    });
  });

  it("saves a replay result as a case without the replay flags", async () => {
    const run = await simulationHarnessService.startRun({
      organizationId: orgId,
      kind: "replay",
      cases: [
        {
          seed: [{ role: "customer", text: "Do you ship to Porto?" }],
          expectations: { referenceReply: "Yes", replay: true, originalAt: null, title: "Ship" },
        },
      ],
    });
    const [item] = await AppDataSource.getRepository(SimulationRunItem).find({
      where: { run_id: run.id },
    });
    const testCase = await testCaseService.createFromRunItem(orgId, item.id, {
      expectHandoff: false,
    });
    expect(testCase).toMatchObject({ source: "replay", title: "Ship" });
    expect(testCase.expectations).toEqual({ referenceReply: "Yes", expectHandoff: false });
  });

  it("refuses a regression run without cases", async () => {
    await expect(testCaseService.startRegression({ organizationId: orgId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

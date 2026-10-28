import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ActionLog } from "../../database/entities/action-log.entity";
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

import { simulationHarnessService } from "../../services/simulation/simulation-harness.service";
import {
  scoreTurn,
  type TurnFacts,
  type JudgeOpinion,
} from "../../services/simulation/turn-judge.service";

const goodJudge: JudgeOpinion = {
  agreement: "same",
  quality: "good",
  risky: false,
  knowledgeMissing: false,
  meetsExpectedOutcome: null,
  repeatsAvoidedReply: false,
  reasoning: "Same answer.",
};

const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  reply: "It ships tomorrow.",
  handedOff: false,
  tools: [],
  actionClaimFlagged: false,
  playbookId: null,
  ...over,
});

/** D7-10: deterministic checks + LLM judge, bucketed for the replay report. */
describe("turn scoring", () => {
  it("buckets an agreeing answer as answered and passes", () => {
    const verdict = scoreTurn(facts(), { referenceReply: "Ships tomorrow" }, goodJudge);
    expect(verdict.bucket).toBe("answered");
    expect(verdict.passed).toBe(true);
  });

  it("puts hand-offs, risky, missing-knowledge and action turns in their buckets", () => {
    expect(scoreTurn(facts({ reply: null, handedOff: true }), {}, null).bucket).toBe("handed_off");
    expect(scoreTurn(facts(), {}, { ...goodJudge, risky: true }).bucket).toBe("wrong_or_risky");
    expect(scoreTurn(facts(), {}, { ...goodJudge, quality: "wrong" }).bucket).toBe(
      "wrong_or_risky",
    );
    expect(scoreTurn(facts(), {}, { ...goodJudge, knowledgeMissing: true }).bucket).toBe(
      "knowledge_missing",
    );
    const write = { name: "cancel_order", readOnly: false, outcome: "simulated", args: {} };
    expect(scoreTurn(facts({ tools: [write] }), {}, goodJudge).bucket).toBe("needed_action");
    expect(scoreTurn(facts({ reply: null }), {}, null).bucket).toBe("wrong_or_risky");
  });

  it("fails an unbacked action claim and tool / hand-off expectations", () => {
    const flagged = scoreTurn(facts({ actionClaimFlagged: true }), {}, goodJudge);
    expect(flagged.bucket).toBe("wrong_or_risky");
    expect(flagged.passed).toBe(false);

    const read = { name: "get_order", readOnly: true, outcome: "success", args: {} };
    const verdict = scoreTurn(
      facts({ tools: [read] }),
      { mustCallTools: ["track_order"], mustNotCallTools: ["get_order"], expectHandoff: true },
      goodJudge,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.checks.filter((c) => !c.passed).map((c) => [c.id, c.detail])).toEqual([
      ["must_call", ["track_order"]],
      ["must_not_call", ["get_order"]],
      ["handoff", undefined],
    ]);
  });

  it("fails replies that miss the expected outcome or repeat the avoided reply", () => {
    expect(
      scoreTurn(facts(), { expectedOutcome: "x" }, { ...goodJudge, meetsExpectedOutcome: false })
        .passed,
    ).toBe(false);
    expect(
      scoreTurn(facts(), { avoidReply: "x" }, { ...goodJudge, repeatsAvoidedReply: true }).passed,
    ).toBe(false);
  });

  it("cannot pass without the judge when one was due, but still fails on checks", () => {
    expect(scoreTurn(facts(), { referenceReply: "x" }, null, { judgeFailed: true }).passed).toBe(
      null,
    );
    expect(
      scoreTurn(facts({ actionClaimFlagged: true }), {}, null, { judgeFailed: true }).passed,
    ).toBe(false);
  });
});

describe("harness judging", () => {
  const orgId = "d7100000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Judge Org", slug: "d710-org" }));
    }
  });

  beforeEach(async () => {
    mockInvoke.mockReset();
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  async function runOne(expectations: Record<string, unknown> | null) {
    const run = await simulationHarnessService.startRun({
      organizationId: orgId,
      cases: [
        {
          seed: [{ role: "customer", text: "Cancel order 1001 please" }],
          expectations,
        },
      ],
    });
    const [item] = await AppDataSource.getRepository(SimulationRunItem).find({
      where: { run_id: run.id },
    });
    await simulationHarnessService.runItem(item.conversation_id!, async (conversationId) => {
      await AppDataSource.getRepository(Message).insert({
        conversation_id: conversationId,
        content: "I've requested the cancellation.",
        type: MessageType.BOT_AGENT,
      });
      await AppDataSource.getRepository(ActionLog).insert({
        organization_id: orgId,
        conversation_id: conversationId,
        tool_name: "cancel_order",
        read_only: false,
        args: { orderId: "1001" },
        outcome: "simulated",
      });
    });
    return AppDataSource.getRepository(SimulationRunItem).findOneByOrFail({ id: item.id });
  }

  it("judges a replayed turn and stores the verdict and bucket", async () => {
    mockInvoke.mockResolvedValue(JSON.stringify({ ...goodJudge, agreement: "partial" }));
    const item = await runOne({ referenceReply: "Done, it's cancelled.", replay: true });

    expect(item.status).toBe("completed");
    expect(item.bucket).toBe("needed_action");
    expect(item.verdict).toMatchObject({
      reply: "I've requested the cancellation.",
      passed: true,
      tools: [{ name: "cancel_order", readOnly: false, outcome: "simulated" }],
      judge: { agreement: "partial" },
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, tier: "medium" }),
    );
  });

  it("a judge failure leaves the item completed with passed unknown", async () => {
    mockInvoke.mockRejectedValue(new Error("LLM down"));
    const item = await runOne({ referenceReply: "Done." });
    expect(item.status).toBe("completed");
    expect(item.verdict).toMatchObject({ passed: null, judgeFailed: true });
  });

  it("does not judge plain simulations", async () => {
    const item = await runOne(null);
    expect(item.verdict).toBeNull();
    expect(item.bucket).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("replay report", () => {
  const { buildReplayReport } = jest.requireActual<
    typeof import("../../services/simulation/replay-report")
  >("../../services/simulation/replay-report");

  const item = (over: Record<string, unknown>) =>
    ({
      id: "i",
      status: "completed",
      seed: [{ role: "customer", text: "Where is 1001?" }],
      source_ref: "conversation:d7110000-0000-4000-8000-000000000001:0",
      expectations: { referenceReply: "Tomorrow", replay: true },
      conversation_id: "c",
      verdict: null,
      bucket: null,
      ...over,
    }) as never;

  it("counts buckets out of the judged sample, with examples next to the human reply", () => {
    const verdict = scoreTurn(facts(), { referenceReply: "Tomorrow" }, goodJudge);
    const report = buildReplayReport({ id: "r" } as never, [
      ...Array.from({ length: 7 }, (_, i) => item({ id: `a${i}`, verdict, bucket: "answered" })),
      item({ id: "p", status: "pending" }),
      item({ id: "f", status: "failed" }),
    ]);
    expect(report.sampleSize).toBe(7);
    expect(report.inProgress).toBe(1);
    expect(report.notJudged).toBe(1);
    expect(report.agreement).toEqual({ same: 7, partial: 0, different: 0 });
    const answered = report.buckets.find((b) => b.bucket === "answered")!;
    expect(answered.count).toBe(7);
    expect(answered.examples).toHaveLength(5);
    expect(answered.examples[0]).toMatchObject({
      customerMessage: "Where is 1001?",
      reply: "It ships tomorrow.",
      referenceReply: "Tomorrow",
      sourceConversationId: "d7110000-0000-4000-8000-000000000001",
    });
    expect(report).not.toHaveProperty("percent");
  });
});

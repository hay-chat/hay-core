import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { SimulationRun } from "../../database/entities/simulation-run.entity";
import { SimulationRunItem } from "../../database/entities/simulation-run-item.entity";
import { emitUsage } from "../../services/llm/usage-sink";
import { conversationRepository } from "../../repositories/conversation.repository";
import { SIMULATION_CAPS } from "../../config/simulation-caps";

const enqueued: Array<{ conversationId: string; trigger: string }> = [];

jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: {
    enqueue: jest.fn(async (conversationId: string, _org: string, trigger: string) => {
      enqueued.push({ conversationId, trigger });
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
jest.mock("../../services/conversation-alert.service", () => ({
  conversationAlertService: {
    onConversationStatusChanged: jest.fn(),
    onCustomerMessage: jest.fn(),
  },
}));

import {
  simulationHarnessService,
  SimulationError,
} from "../../services/simulation/simulation-harness.service";

const usageEvent = (promptTokens: number, completionTokens: number) => ({
  kind: "chat" as const,
  usage: { promptTokens, cachedPromptTokens: 0, completionTokens, totalTokens: 0 },
  model: "test-model",
  provider: "test",
});

/** D7-7: simulation runs go through the queue, cost tracked, capped, invisible. */
describe("simulation harness", () => {
  const orgId = "d7700000-0000-4000-8000-000000000001";
  const twoCases = [
    {
      seed: [
        { role: "customer" as const, text: "Hi, where is my order?" },
        { role: "agent" as const, text: "Can I have the order number?" },
        { role: "customer" as const, text: "It's 1001" },
      ],
      sourceRef: "t1:2",
    },
    { seed: [{ role: "customer" as const, text: "Do you ship to Lisbon?" }] },
  ];

  async function itemsOf(runId: string) {
    return AppDataSource.getRepository(SimulationRunItem).find({
      where: { run_id: runId },
      order: { position: "ASC" },
    });
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Simulation Org", slug: "d77-org" }));
    }
  });

  beforeEach(async () => {
    enqueued.length = 0;
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.getRepository(Organization).update(orgId, { limits: {} });
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("queues one case at a time as a seeded simulation conversation", async () => {
    const run = await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });

    const items = await itemsOf(run.id);
    expect(items.map((i) => i.status)).toEqual(["running", "pending"]);
    expect(enqueued).toEqual([{ conversationId: items[0].conversation_id, trigger: "simulation" }]);

    const conversation = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: items[0].conversation_id!,
    });
    expect(conversation.metadata).toMatchObject({
      runKind: "simulation",
      simulationRunId: run.id,
      dryRun: true,
    });
    expect(conversation.needs_processing).toBe(true);
    expect(conversation.customer_id).toBeNull();

    const seeded = await AppDataSource.getRepository(Message).find({
      where: { conversation_id: conversation.id },
      order: { created_at: "ASC" },
    });
    const turns = seeded.filter((m) => m.type !== MessageType.SYSTEM);
    expect(turns.map((m) => [m.type, m.content])).toEqual([
      [MessageType.CUSTOMER, "Hi, where is my order?"],
      [MessageType.HUMAN_AGENT, "Can I have the order number?"],
      [MessageType.CUSTOMER, "It's 1001"],
    ]);
  });

  it("records LLM usage per model, closes the conversation and moves to the next case", async () => {
    const run = await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });
    const [first] = await itemsOf(run.id);

    await simulationHarnessService.runItem(first.conversation_id!, async () => {
      emitUsage(usageEvent(100, 20));
      emitUsage(usageEvent(50, 10));
    });

    let items = await itemsOf(run.id);
    expect(items[0].status).toBe("completed");
    expect(items[0].usage).toEqual({
      "test:test-model": {
        calls: 2,
        promptTokens: 150,
        cachedPromptTokens: 0,
        completionTokens: 30,
      },
    });
    expect(items[1].status).toBe("running");
    const closed = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: first.conversation_id!,
    });
    expect(closed.status).toBe("closed");
    expect(closed.needs_processing).toBe(false);

    // A failing conversation fails its item; the run still completes.
    await simulationHarnessService.runItem(items[1].conversation_id!, async () => {
      throw new Error("LLM down");
    });
    items = await itemsOf(run.id);
    expect(items[1]).toMatchObject({ status: "failed", error: "LLM down" });

    const done = await AppDataSource.getRepository(SimulationRun).findOneByOrFail({ id: run.id });
    expect(done).toMatchObject({ status: "completed", completed_count: 1, failed_count: 1 });
    expect(done.usage["test:test-model"].promptTokens).toBe(150);
  });

  it("stops a run at its token ceiling and skips the rest", async () => {
    const run = await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });
    const [first] = await itemsOf(run.id);
    await simulationHarnessService.runItem(first.conversation_id!, async () => {
      emitUsage(usageEvent(SIMULATION_CAPS.maxTokensPerRun, 1));
    });
    const after = await AppDataSource.getRepository(SimulationRun).findOneByOrFail({ id: run.id });
    expect(after).toMatchObject({ status: "capped", skipped_count: 1 });
    expect((await itemsOf(run.id))[1].status).toBe("skipped");
    expect(enqueued).toHaveLength(1);
  });

  it("caps simulated conversations per month from organization.limits", async () => {
    await AppDataSource.getRepository(Organization).update(orgId, {
      limits: { maxSimulationsPerMonth: 3 },
    });
    await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });
    expect(await simulationHarnessService.getAllowance(orgId)).toEqual({
      limit: 3,
      used: 2,
      remaining: 1,
    });
    await expect(
      simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("holds the monthly cap when runs start at the same time (F1)", async () => {
    await AppDataSource.getRepository(Organization).update(orgId, {
      limits: { maxSimulationsPerMonth: 3 },
    });
    // Open pooled connections first so the starts really run side by side.
    await Promise.all(
      Array.from({ length: 5 }, () => AppDataSource.query("SELECT pg_sleep(0.05)")),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "LIMIT_REACHED" });
    }
    expect((await simulationHarnessService.getAllowance(orgId)).used).toBe(2);
  });

  it("empties simulation items past the organization's retention, keeping them counted (F2)", async () => {
    await AppDataSource.getRepository(Organization).update(orgId, {
      settings: { retentionDays: 30 },
    });
    const run = await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });
    const [first, second] = await itemsOf(run.id);
    await AppDataSource.getRepository(SimulationRunItem).update(second.id, {
      expectations: { referenceReply: "Your order 1001 ships today" },
    });
    await simulationHarnessService.cancelRun(orgId, run.id); // second case: skipped
    // Both items are old; the one still running must be left alone.
    await AppDataSource.query(
      `UPDATE simulation_run_items SET created_at = now() - interval '40 days' WHERE run_id = $1`,
      [run.id],
    );

    expect(await simulationHarnessService.scrubExpired()).toBe(1);
    const [stillRunning, old] = await itemsOf(run.id);
    expect(stillRunning.id).toBe(first.id);
    expect(stillRunning.seed).toHaveLength(3);
    expect(old).toMatchObject({ seed: [], expectations: null, verdict: null, source_ref: null });
    expect(await simulationHarnessService.scrubExpired()).toBe(0);
    await AppDataSource.getRepository(Organization).update(orgId, { settings: {} });
  });

  it("refuses a case that does not end with a customer turn", async () => {
    await expect(
      simulationHarnessService.startRun({
        organizationId: orgId,
        cases: [{ seed: [{ role: "agent", text: "Hello" }] }],
      }),
    ).rejects.toBeInstanceOf(SimulationError);
  });

  it("cancelling skips the queued cases; the one in progress finishes", async () => {
    const run = await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });
    const [first] = await itemsOf(run.id);
    await simulationHarnessService.cancelRun(orgId, run.id);

    // The worker picks the queued conversation up later: the item still runs
    // (it was in progress), but nothing new is dispatched.
    const process = jest.fn(async () => undefined);
    await simulationHarnessService.runItem(first.conversation_id!, process);
    expect(process).toHaveBeenCalledTimes(1);
    const items = await itemsOf(run.id);
    expect(items.map((i) => i.status)).toEqual(["completed", "skipped"]);
    const after = await AppDataSource.getRepository(SimulationRun).findOneByOrFail({ id: run.id });
    expect(after.status).toBe("cancelled");
    expect(enqueued).toHaveLength(1);
  });

  it("never holds a test conversation's reply for approval, even in test mode", async () => {
    await AppDataSource.getRepository(Organization).update(orgId, {
      settings: { testModeDefault: true },
    });
    try {
      const make = (metadata: Record<string, unknown>) =>
        conversationRepository.create({
          title: "t",
          organization_id: orgId,
          status: "open",
          metadata,
        });
      const replyTo = async (conversation: Conversation) => {
        await conversation.addMessage({ content: "Hello?", type: MessageType.CUSTOMER });
        return conversation.addMessage({ content: "Hi there", type: MessageType.BOT_AGENT });
      };
      const simulated = await replyTo(await make({ runKind: "simulation" }));
      expect(simulated.deliveryState).toBe("sent");
      const real = await replyTo(await make({}));
      expect(real.deliveryState).toBe("queued");
    } finally {
      await AppDataSource.getRepository(Organization).update(orgId, { settings: {} });
    }
  });

  it("leaves simulation conversations out of the Inbox, counts and the inactivity check", async () => {
    const run = await simulationHarnessService.startRun({ organizationId: orgId, cases: twoCases });
    const [first] = await itemsOf(run.id);
    const real = await conversationRepository.create({
      title: "real",
      organization_id: orgId,
      status: "open",
      metadata: {},
    });

    const ids = (await conversationRepository.findByOrganization(orgId)).map((c) => c.id);
    expect(ids).toContain(real.id);
    expect(ids).not.toContain(first.conversation_id);
    expect(await conversationRepository.countByFilters({ organizationId: orgId })).toBe(1);
    const open = (await conversationRepository.findAllOpenConversations()).map((c) => c.id);
    expect(open).toContain(real.id);
    expect(open).not.toContain(first.conversation_id);
    const page = await conversationRepository.paginateQuery(
      { pagination: { page: 1, limit: 50, offset: 0 }, sorting: { orderDirection: "desc" } },
      orgId,
    );
    const pageIds = (page as { items: Conversation[] }).items.map((c) => c.id);
    expect(pageIds).toEqual([real.id]);
  });
});

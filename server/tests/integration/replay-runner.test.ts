import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType, MessageStatus } from "../../database/entities/message.entity";
import { SimulationRunItem } from "../../database/entities/simulation-run-item.entity";
import { TestTranscript } from "../../database/entities/test-transcript.entity";
import { DeliveryState } from "../../types/message-feedback.types";

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

import { replayCases, replayService } from "../../services/simulation/replay.service";

/** D7-9: one counterfactual case per customer turn, the human reply as reference. */
describe("replay runner", () => {
  const orgId = "d7900000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Replay Org", slug: "d79-org" }));
    }
  });

  beforeEach(async () => {
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM test_transcripts WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM simulation_runs WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM test_transcripts WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("makes one case per customer turn with the next human reply as reference", () => {
    const cases = replayCases({
      ref: "transcript:abc",
      title: "Order 1001",
      turns: [
        { role: "customer", text: "Where is my order?", timestamp: "2026-01-02T10:00:00.000Z" },
        { role: "agent", text: "Can I have the number?" },
        { role: "customer", text: "1001" },
        { role: "agent", text: "It ships tomorrow." },
        { role: "customer", text: "Thanks!" },
      ],
    });

    expect(cases).toHaveLength(3);
    expect(cases[0]).toEqual({
      seed: [{ role: "customer", text: "Where is my order?" }],
      sourceRef: "transcript:abc:0",
      expectations: {
        referenceReply: "Can I have the number?",
        replay: true,
        originalAt: "2026-01-02T10:00:00.000Z",
        title: "Order 1001",
      },
    });
    expect(cases[1].seed.map((t) => t.text)).toEqual([
      "Where is my order?",
      "Can I have the number?",
      "1001",
    ]);
    expect(cases[1].expectations?.referenceReply).toBe("It ships tomorrow.");
    // The shopper had the last word: nothing to compare with.
    expect(cases[2].expectations?.referenceReply).toBeNull();

    expect(
      replayCases(
        { ref: "x", title: null, turns: [{ role: "customer", text: "a" }] },
        { maxTurns: 1 },
      ),
    ).toHaveLength(1);
  });

  it("starts a replay run from imported transcripts", async () => {
    const transcript = await AppDataSource.getRepository(TestTranscript).save({
      organization_id: orgId,
      source: "paste",
      title: "Refund",
      turns: [
        { role: "customer" as const, text: "I want a refund" },
        { role: "agent" as const, text: "Sorry to hear that, what's the order?" },
        { role: "customer" as const, text: "#55" },
      ],
      turn_count: 3,
      import_batch_id: "d7900000-0000-4000-8000-0000000000aa",
    });

    const run = await replayService.start({
      organizationId: orgId,
      transcriptIds: [transcript.id],
    });
    expect(run.kind).toBe("replay");
    expect(run.item_count).toBe(2);

    const items = await AppDataSource.getRepository(SimulationRunItem).find({
      where: { run_id: run.id },
      order: { position: "ASC" },
    });
    expect(items.map((i) => i.source_ref)).toEqual([
      `transcript:${transcript.id}:0`,
      `transcript:${transcript.id}:2`,
    ]);
    expect(items[0].expectations).toMatchObject({
      referenceReply: "Sorry to hear that, what's the order?",
      replay: true,
    });
  });

  it("replays a Hay.chat conversation from what the shopper actually saw", async () => {
    const conversation = await AppDataSource.getRepository(Conversation).save({
      organization_id: orgId,
      title: "Shipping",
      channel: "web",
      status: "closed",
      context: {},
      metadata: {},
    });
    const base = Date.now() - 60_000;
    await AppDataSource.getRepository(Message).insert([
      {
        conversation_id: conversation.id,
        content: "Do you ship to Porto?",
        type: MessageType.CUSTOMER,
        created_at: new Date(base),
      },
      {
        conversation_id: conversation.id,
        content: "Blocked draft",
        type: MessageType.BOT_AGENT,
        status: MessageStatus.REJECTED,
        deliveryState: DeliveryState.BLOCKED,
        created_at: new Date(base + 1),
      },
      {
        conversation_id: conversation.id,
        content: "Yes, in 2 days.",
        type: MessageType.HUMAN_AGENT,
        created_at: new Date(base + 2),
      },
    ]);

    const run = await replayService.start({
      organizationId: orgId,
      conversationIds: [conversation.id],
    });
    const [item] = await AppDataSource.getRepository(SimulationRunItem).find({
      where: { run_id: run.id },
    });
    expect(item.seed).toEqual([{ role: "customer", text: "Do you ship to Porto?" }]);
    expect(item.expectations?.referenceReply).toBe("Yes, in 2 days.");
    expect(item.expectations?.originalAt).toBe(new Date(base).toISOString());
  });

  it("refuses test conversations and other organizations' transcripts", async () => {
    const playground = await AppDataSource.getRepository(Conversation).save({
      organization_id: orgId,
      title: "Playground",
      channel: "web",
      status: "open",
      context: {},
      metadata: { isPlayground: true },
    });
    await expect(
      replayService.start({ organizationId: orgId, conversationIds: [playground.id] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      replayService.start({
        organizationId: orgId,
        transcriptIds: ["d7900000-0000-4000-8000-0000000000ff"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("store data changed since", () => {
  const { storeDataMayHaveChanged } = jest.requireActual<
    typeof import("../../services/simulation/replay.service")
  >("../../services/simulation/replay.service");
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("flags replayed turns that read the live store after the fact", () => {
    expect(
      storeDataMayHaveChanged({ replay: true, originalAt: "2026-10-01T00:00:00Z" }, 1, now),
    ).toBe(true);
    expect(storeDataMayHaveChanged({ replay: true, originalAt: null }, 2, now)).toBe(true);
    expect(
      storeDataMayHaveChanged({ replay: true, originalAt: "2026-10-28T11:30:00Z" }, 1, now),
    ).toBe(false);
    expect(
      storeDataMayHaveChanged({ replay: true, originalAt: "2026-10-01T00:00:00Z" }, 0, now),
    ).toBe(false);
    expect(storeDataMayHaveChanged({ originalAt: "2026-10-01T00:00:00Z" }, 3, now)).toBe(false);
  });
});

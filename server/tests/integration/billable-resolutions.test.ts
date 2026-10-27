import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ConversationOutcome } from "../../database/entities/conversation-outcome.entity";
import { ConversationTakeoverEvent } from "../../database/entities/conversation-takeover-event.entity";
import { AnalyticsService } from "../../services/analytics.service";
import { ConversationRepository } from "../../repositories/conversation.repository";
import { AddConversationHandedOffAt1784600000000 } from "../../database/migrations/1784600000000-AddConversationHandedOffAt";

// Repository writes broadcast over Redis/WebSocket and send push alerts; this
// suite only cares about the row.
jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
  },
}));
jest.mock("../../services/push-notification.service", () => ({
  pushNotificationService: { onConversationStatusChanged: jest.fn() },
}));

/**
 * DB-backed: the handoff stamp is a repository side effect, so a mock would
 * only restate the implementation. The billing outcome rules themselves live
 * in close-classifier.test.ts and close-outcome-rules.test.ts.
 */
describe("billable resolutions: handed_off_at", () => {
  const orgId = "b111ab1e-0000-4000-8000-000000000001";
  const userId = "b111ab1e-0000-4000-8000-0000000000aa";
  const periodStart = new Date("2026-10-01T00:00:00Z");
  const periodEnd = new Date("2026-10-31T23:59:59Z");
  const inPeriod = new Date("2026-10-15T12:00:00Z");

  const analytics = new AnalyticsService();
  const repository = new ConversationRepository();

  const metrics = () =>
    analytics.getConversationMetrics({
      organizationId: orgId,
      startDate: periodStart,
      endDate: periodEnd,
    });

  async function seed(overrides: Partial<Conversation> = {}): Promise<Conversation> {
    const repo = AppDataSource.getRepository(Conversation);
    const saved = await repo.save(
      repo.create({
        title: "billing test",
        organization_id: orgId,
        status: "resolved",
        ended_at: inPeriod,
        resolution_metadata: {
          resolved: true,
          confidence: 1,
          reason: "user_indicated_close_satisfied",
        },
        metadata: {},
        ...overrides,
      }),
    );
    // created_at is a CreateDateColumn; pin it inside the period unless the
    // test overrides it.
    await repo.update({ id: saved.id }, { created_at: overrides.created_at ?? inPeriod });
    return saved;
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({ id: orgId, name: "Billing Test Org", slug: "billing-test-org" }),
      );
    }

    const userRepo = AppDataSource.getRepository(User);
    if (!(await userRepo.findOne({ where: { id: userId } }))) {
      await userRepo.save(
        userRepo.create({ id: userId, email: "billing-test@example.com", password: "x" }),
      );
    }
  });

  beforeEach(async () => {
    await AppDataSource.getRepository(ConversationOutcome).delete({ organization_id: orgId });
    await AppDataSource.getRepository(ConversationTakeoverEvent).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(ConversationTakeoverEvent).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(User).delete({ id: userId });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("stamps handed_off_at on the first handoff and keeps it after a hand-back", async () => {
    const created = await repository.create({
      title: "lifecycle",
      organization_id: orgId,
      status: "open",
    });
    expect(created.handed_off_at).toBeNull();

    const handedOff = await repository.update(created.id, orgId, { status: "pending-human" });
    const firstStamp = handedOff!.handed_off_at;
    expect(firstStamp).toBeInstanceOf(Date);

    // Human hands it back, then the AI resolves it.
    await repository.update(created.id, orgId, { status: "open" });
    await repository.updateById(created.id, { status: "human-took-over" });
    const resolved = await repository.updateById(created.id, {
      status: "resolved",
      ended_at: inPeriod,
      resolution_metadata: {
        resolved: true,
        confidence: 1,
        reason: "user_indicated_close_satisfied",
      },
    });
    expect(resolved!.handed_off_at!.getTime()).toBe(firstStamp!.getTime());

    // The rule outcome recorded at close never bills a hand-off; only the
    // close classifier can decide the AI resolved it.

    await AppDataSource.getRepository(Conversation).update(
      { id: created.id },
      { created_at: inPeriod },
    );
    expect((await metrics()).billableResolutions).toBe(0);
  });

  it("stamps a conversation created straight into a human status", async () => {
    const created = await repository.create({
      title: "parked",
      organization_id: orgId,
      status: "pending-human",
    });
    expect(created.handed_off_at).toBeInstanceOf(Date);
  });

  it("migration backfills handed_off_at from earlier handoff traces", async () => {
    const withSummary = await seed({ summary: "AI handed off" });

    const takenOver = await seed();
    await AppDataSource.getRepository(ConversationTakeoverEvent).save({
      organization_id: orgId,
      conversation_id: takenOver.id,
      user_id: userId,
      started_at: new Date("2026-10-10T08:00:00Z"),
      ended_at: inPeriod,
    });

    const humanReplied = await seed();
    await AppDataSource.getRepository(Message).save({
      conversation_id: humanReplied.id,
      content: "Hi, a human here",
      type: MessageType.HUMAN_AGENT,
    });

    const aiOnly = await seed();

    const queryRunner = AppDataSource.createQueryRunner();
    try {
      await new AddConversationHandedOffAt1784600000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    const repo = AppDataSource.getRepository(Conversation);
    const stamp = async (id: string) => (await repo.findOneByOrFail({ id })).handed_off_at;
    expect(await stamp(withSummary.id)).toBeInstanceOf(Date);
    expect((await stamp(takenOver.id))!.toISOString()).toBe("2026-10-10T08:00:00.000Z");
    expect(await stamp(humanReplied.id)).toBeInstanceOf(Date);
    expect(await stamp(aiOnly.id)).toBeNull();
  });
});

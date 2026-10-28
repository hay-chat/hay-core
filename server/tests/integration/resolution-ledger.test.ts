import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { AuditLog } from "../../entities/audit-log.entity";
import { ConversationOutcome } from "../../database/entities/conversation-outcome.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import type { ConversationOutcomeKind } from "../../services/close-classification/outcome-rules";
import { AnalyticsService } from "../../services/analytics.service";
import {
  ResolutionLedgerService,
  exclusionAllowance,
  periodFor,
} from "../../services/resolution-ledger.service";

/**
 * DB-backed: the allowance check, the billable count the operator reads and
 * the audit row all live in SQL, so a mock would only restate them.
 */
describe("resolution ledger and exclusions (D1-5, D1-6)", () => {
  const orgId = "1ed6e700-0000-4000-8000-000000000001";
  const userId = "1ed6e700-0000-4000-8000-0000000000aa";
  const service = new ResolutionLedgerService();
  const analytics = new AnalyticsService();
  const period = periodFor();
  // A minute into the current UTC month: always in the period, always excludable.
  const inPeriod = new Date(period.start.getTime() + 60_000);

  async function seed(
    count: number,
    overrides: Partial<ConversationOutcome> & { outcome?: ConversationOutcomeKind } = {},
  ): Promise<ConversationOutcome[]> {
    const repo = AppDataSource.getRepository(ConversationOutcome);
    const rows: ConversationOutcome[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(
        await repo.save(
          repo.create({
            organization_id: orgId,
            conversation_id: null,
            closed_at: new Date(inPeriod.getTime() + i * 1000),
            close_status: "resolved",
            close_reason: "inactivity_timeout",
            outcome: "assumed",
            billable: true,
            ai_resolved: true,
            handed_off: false,
            classified_by: "rule",
            classified_at: inPeriod,
            ...overrides,
          }),
        ),
      );
    }
    return rows;
  }

  const billableCount = async () =>
    (
      await analytics.getConversationMetrics({
        organizationId: orgId,
        startDate: period.start,
        endDate: period.end,
      })
    ).billableResolutions;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Ledger Org", slug: "ledger-org" }));
    }
    const userRepo = AppDataSource.getRepository(User);
    if (!(await userRepo.findOne({ where: { id: userId } }))) {
      await userRepo.save(
        userRepo.create({ id: userId, email: "ledger-test@example.com", password: "x" }),
      );
    }
  });

  beforeEach(async () => {
    await AppDataSource.getRepository(ConversationOutcome).delete({ organization_id: orgId });
    await AppDataSource.getRepository(AuditLog).delete({ organizationId: orgId });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(ConversationOutcome).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(AuditLog).delete({ organizationId: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(User).delete({ id: userId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("marking a classified conversation as spam stops billing it; Not spam re-classifies", async () => {
    const conversation = await AppDataSource.getRepository(Conversation).save(
      AppDataSource.getRepository(Conversation).create({
        title: "closed",
        organization_id: orgId,
        status: "resolved",
        metadata: {},
      }),
    );
    const [billed] = await seed(1, { conversation_id: conversation.id });
    // A close from two periods back has been billed and is left alone.
    const old = new Date(Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth() - 2, 5));
    const [closedPeriod] = await seed(1, { conversation_id: conversation.id, closed_at: old });
    expect(await billableCount()).toBe(1);

    const marked = await service.markConversationSpam({
      organizationId: orgId,
      conversationId: conversation.id,
      userId,
    });
    expect(marked).toBe(1);
    expect(await billableCount()).toBe(0);
    const repo = AppDataSource.getRepository(ConversationOutcome);
    expect(await repo.findOneByOrFail({ id: billed.id })).toMatchObject({
      outcome: "spam",
      billable: false,
      classified_by: "staff",
    });
    expect(await repo.findOneByOrFail({ id: closedPeriod.id })).toMatchObject({
      outcome: "assumed",
      billable: true,
    });
    const audit = await AppDataSource.getRepository(AuditLog).findOneByOrFail({
      organizationId: orgId,
      action: "conversation.spam.marked",
    });
    expect(audit.changes).toMatchObject({
      outcomes: [{ outcomeId: billed.id, outcome: { from: "assumed", to: "spam" } }],
    });

    await service.clearConversationSpam({
      organizationId: orgId,
      conversationId: conversation.id,
      userId,
    });
    expect(await repo.findOneByOrFail({ id: billed.id })).toMatchObject({
      classified_at: null,
      classified_by: "rule",
      attempts: 0,
    });
    expect(
      await AppDataSource.getRepository(AuditLog).countBy({
        organizationId: orgId,
        action: "conversation.spam.cleared",
      }),
    ).toBe(1);
  });

  it("allowance is 5 % of the period, at least one", () => {
    expect(exclusionAllowance(0)).toBe(0);
    expect(exclusionAllowance(3)).toBe(1);
    expect(exclusionAllowance(40)).toBe(2);
    expect(exclusionAllowance(99)).toBe(4);
  });

  it("excludes instantly within 5 %, then records review requests that stay billed", async () => {
    const rows = await seed(40);
    expect(await billableCount()).toBe(40);

    const first = await service.exclude({
      organizationId: orgId,
      outcomeId: rows[0].id,
      userId,
      reason: "Owner testing from a phone",
    });
    expect(first).toEqual({ status: "excluded", used: 1, allowance: 2 });
    const second = await service.exclude({
      organizationId: orgId,
      outcomeId: rows[1].id,
      userId,
      reason: "Spam",
    });
    expect(second.status).toBe("excluded");
    expect(await billableCount()).toBe(38);

    const third = await service.exclude({
      organizationId: orgId,
      outcomeId: rows[2].id,
      userId,
      reason: "Customer came back by email",
    });
    expect(third).toEqual({ status: "pending_review", used: 2, allowance: 2 });
    expect(await billableCount()).toBe(38);

    const stored = await AppDataSource.getRepository(ConversationOutcome).findOneByOrFail({
      id: rows[2].id,
    });
    expect(stored.excluded_at).toBeNull();
    expect(stored.exclusion_requested_by).toBe(userId);
    expect(stored.exclusion_reason).toBe("Customer came back by email");

    const audits = await AppDataSource.getRepository(AuditLog).find({
      where: { organizationId: orgId },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      "billing.resolution.exclude",
      "billing.resolution.exclude",
      "billing.resolution.exclusion_review_requested",
    ]);
    expect(audits.every((a) => a.userId === userId)).toBe(true);

    const usage = await service.getUsage(orgId);
    expect(usage.billable).toBe(38);
    expect(usage.breakdown.excluded).toBe(2);
    expect(usage.breakdown.pendingReview).toBe(1);
    expect(usage.exclusions).toEqual({ used: 2, allowance: 2, open: true });
  });

  it("refuses non-billed, reversed, repeated and blank-reason exclusions", async () => {
    const [unhappy] = await seed(1, { outcome: "unhappy", billable: false, ai_resolved: false });
    const [reversed] = await seed(1, { reversed_at: inPeriod, reversal_reason: "returned" });
    const [billed] = await seed(1);
    const exclude = (outcomeId: string, reason = "because") =>
      service.exclude({ organizationId: orgId, outcomeId, userId, reason });

    await expect(exclude(unhappy.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(exclude(reversed.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(exclude(billed.id, "   ")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await exclude(billed.id);
    await expect(exclude(billed.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.exclude({
        organizationId: "1ed6e700-0000-4000-8000-000000000999",
        outcomeId: billed.id,
        userId,
        reason: "other org",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses exclusions older than the previous period", async () => {
    const old = new Date(
      Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth() - 2, 15),
    );
    const [row] = await seed(1, { closed_at: old });
    await expect(
      service.exclude({ organizationId: orgId, outcomeId: row.id, userId, reason: "late" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("breaks the period down by outcome and lists only billable rows", async () => {
    await seed(3);
    await seed(1, { outcome: "confirmed", close_reason: "user_indicated_close_satisfied" });
    await seed(1, { reversed_at: inPeriod, reversal_reason: "returned" });
    await seed(2, { outcome: "abandoned", billable: false, ai_resolved: false });
    await seed(1, { outcome: "human", billable: false, ai_resolved: false, handed_off: true });
    await seed(1, { outcome: "test", billable: false, ai_resolved: false });

    const usage = await service.getUsage(orgId);
    expect(usage.billable).toBe(4);
    expect(usage.breakdown.reversed).toBe(1);
    expect(usage.breakdown.notBilled).toMatchObject({ abandoned: 2, human: 1, test: 1, spam: 0 });

    const ledger = await service.listLedger(orgId, { page: 1, pageSize: 25 });
    expect(ledger.total).toBe(5);
    expect(ledger.items.map((i) => i.status).sort()).toEqual([
      "billed",
      "billed",
      "billed",
      "billed",
      "reversed",
    ]);
  });

  it("exports the ledger as CSV with formulas neutralised", async () => {
    await seed(1, { classification_reason: '=HYPERLINK("x")' });
    const csv = await service.exportLedgerCsv(orgId);
    const [header, line] = csv.split("\n");
    expect(header).toBe(
      "closed_at,conversation_id,outcome,status,close_reason,classification_reason,exclusion_reason,exclusion_requested_by,exclusion_requested_at",
    );
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain('"assumed","billed"');
  });
});

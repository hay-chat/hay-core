import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { ConversationOutcome } from "../../database/entities/conversation-outcome.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import { Playbook } from "../../database/entities/playbook.entity";
import { analyticsReportsService } from "../../services/analytics-reports.service";
import type { ConversationOutcomeKind } from "../../services/close-classification/outcome-rules";

/**
 * DB-backed: the reports are SQL over conversation_outcomes, so the numbers
 * are only worth checking against real rows.
 */
describe("analytics reports", () => {
  const orgId = "a9a1a1a1-0000-4000-8000-000000000001";
  const otherOrgId = "a9a1a1a1-0000-4000-8000-000000000002";
  const orgIds = [orgId, otherOrgId];
  const playbookA = "a9a1a1a1-0000-4000-8000-0000000000a1";
  const playbookB = "a9a1a1a1-0000-4000-8000-0000000000b1";

  const range = { start: new Date("2026-10-08T00:00:00Z"), end: new Date("2026-10-15T00:00:00Z") };
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));

  interface Close {
    outcome: ConversationOutcomeKind;
    closedAt: Date;
    organizationId?: string;
    aiResolved?: boolean;
    handedOff?: boolean;
    reversed?: boolean;
    excluded?: boolean;
    csat?: number;
    channel?: string;
    metadata?: Record<string, unknown>;
    playbookId?: string;
    area?: string;
    title?: string;
  }

  async function seedClose(close: Close): Promise<string> {
    const organizationId = close.organizationId ?? orgId;
    const conversations = AppDataSource.getRepository(Conversation);
    const conversation = await conversations.save(
      conversations.create({
        title: close.title ?? "analytics test",
        organization_id: organizationId,
        status: "resolved",
        channel: close.channel ?? "web",
        closed_at: close.closedAt,
        handed_off_at: close.handedOff ? close.closedAt : null,
        csat_rating: close.csat ?? null,
        csat_rated_at: close.csat ? close.closedAt : null,
        playbook_id: close.playbookId ?? null,
        metadata: close.metadata ?? {},
      }),
    );
    const outcomes = AppDataSource.getRepository(ConversationOutcome);
    const outcome = await outcomes.save(
      outcomes.create({
        organization_id: organizationId,
        conversation_id: conversation.id,
        closed_at: close.closedAt,
        close_status: "resolved",
        outcome: close.outcome,
        billable: close.aiResolved ?? false,
        ai_resolved: close.aiResolved ?? false,
        handed_off: close.handedOff ?? false,
        classified_by: "llm",
        classified_at: close.closedAt,
        reversed_at: close.reversed ? close.closedAt : null,
        excluded_at: close.excluded ? close.closedAt : null,
      }),
    );
    if (close.area) {
      const issues = AppDataSource.getRepository(InsightIssue);
      await issues.save(
        issues.create({
          organization_id: organizationId,
          source: "ai_review",
          conversation_id: conversation.id,
          conversation_outcome_id: outcome.id,
          polarity: "neutral",
          action_type: "none",
          severity: "low",
          confidence: 1,
          relevance: 0,
          summary: "analytics test",
          area: close.area,
        }),
      );
    }
    return conversation.id;
  }

  async function cleanUp() {
    for (const id of orgIds) {
      await AppDataSource.getRepository(InsightIssue).delete({ organization_id: id });
      await AppDataSource.getRepository(ConversationOutcome).delete({ organization_id: id });
      await AppDataSource.getRepository(Conversation).delete({ organization_id: id });
      await AppDataSource.getRepository(Playbook).delete({ organization_id: id });
    }
  }

  let lowScoreConversationId = "";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const organizations = AppDataSource.getRepository(Organization);
    for (const [index, id] of orgIds.entries()) {
      if (!(await organizations.findOne({ where: { id } }))) {
        await organizations.save(
          organizations.create({
            id,
            name: `Analytics Test Org ${index}`,
            slug: `analytics-test-org-${index}`,
          }),
        );
      }
    }
    await cleanUp();

    const playbooks = AppDataSource.getRepository(Playbook);
    await playbooks.save([
      playbooks.create({
        id: playbookA,
        title: "Where is my order",
        trigger: "order status",
        organization_id: orgId,
      }),
      playbooks.create({
        id: playbookB,
        title: "Refund request",
        trigger: "refund",
        organization_id: orgId,
      }),
    ]);

    // The period under test: seven real closes.
    await seedClose({
      outcome: "confirmed",
      closedAt: day(10),
      aiResolved: true,
      csat: 5,
      playbookId: playbookA,
      area: "Shipping",
    });
    await seedClose({
      outcome: "assumed",
      closedAt: day(10),
      aiResolved: true,
      csat: 4,
      playbookId: playbookA,
      area: " shipping ",
    });
    // The shopper came back within 72 h: no longer a resolution.
    await seedClose({
      outcome: "assumed",
      closedAt: day(11),
      aiResolved: true,
      reversed: true,
      area: "refund",
    });
    lowScoreConversationId = await seedClose({
      outcome: "human",
      closedAt: day(11),
      handedOff: true,
      csat: 1,
      area: "refund",
      title: "Where is my refund?",
      metadata: { handoffReason: "low_confidence" },
    });
    // Planned hand-off from before reasons were stored; not on webchat.
    await seedClose({
      outcome: "assisted",
      closedAt: day(12),
      aiResolved: true,
      handedOff: true,
      channel: "email",
      playbookId: playbookB,
      metadata: { plannedHandoff: true },
    });
    // Handed off with nothing recorded; a stored value that is not a code is not trusted.
    await seedClose({
      outcome: "human",
      closedAt: day(12),
      handedOff: true,
      metadata: { handoffReason: "The customer asked for Maria" },
    });
    await seedClose({ outcome: "abandoned", closedAt: day(13) });

    // Never counted: tests, spam, another organization, another period's edge.
    await seedClose({ outcome: "test", closedAt: day(10), aiResolved: true });
    await seedClose({ outcome: "spam", closedAt: day(10) });
    await seedClose({
      outcome: "confirmed",
      closedAt: day(10),
      aiResolved: true,
      csat: 5,
      area: "shipping",
      organizationId: otherOrgId,
    });
    await seedClose({ outcome: "confirmed", closedAt: range.end, aiResolved: true });

    // The period before.
    await seedClose({ outcome: "confirmed", closedAt: day(3), aiResolved: true, csat: 3 });
    await seedClose({
      outcome: "human",
      closedAt: day(4),
      handedOff: true,
      metadata: { handoffReason: "customer_request" },
    });
  });

  afterAll(async () => {
    await cleanUp();
    await AppDataSource.getRepository(Organization).delete(orgIds);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("overview: AI resolution rate is billed resolutions over real closes", async () => {
    const { current, previous, trend } = await analyticsReportsService.getOverview(orgId, range);

    expect(current.closes).toBe(7);
    expect(current.aiResolved).toBe(3);
    expect(current.aiResolutionRate).toBeCloseTo((3 / 7) * 100);
    expect(current.handedOff).toBe(3);
    expect(current.outcomes).toEqual({
      confirmed: 1,
      assumed: 2,
      assisted: 1,
      abandoned: 1,
      unhappy: 0,
      human: 2,
    });

    expect(previous).toMatchObject({ closes: 2, aiResolved: 1, aiResolutionRate: 50 });

    expect(trend).toEqual([
      { date: "2026-10-10", closes: 2, aiResolved: 2, handedOff: 0 },
      { date: "2026-10-11", closes: 2, aiResolved: 0, handedOff: 1 },
      { date: "2026-10-12", closes: 2, aiResolved: 1, handedOff: 2 },
      { date: "2026-10-13", closes: 1, aiResolved: 0, handedOff: 0 },
    ]);
  });

  it("overview: an excluded resolution stops counting", async () => {
    const outcomes = AppDataSource.getRepository(ConversationOutcome);
    const row = await outcomes.findOneOrFail({
      where: { organization_id: orgId, outcome: "confirmed", closed_at: day(10) },
    });
    await outcomes.update({ id: row.id }, { excluded_at: new Date() });
    try {
      const { current } = await analyticsReportsService.getOverview(orgId, range);
      expect(current).toMatchObject({ closes: 7, aiResolved: 2 });
    } finally {
      await outcomes.update({ id: row.id }, { excluded_at: null });
    }
  });

  it("an empty period has no rates rather than 0%", async () => {
    const empty = {
      start: new Date("2025-01-01T00:00:00Z"),
      end: new Date("2025-01-08T00:00:00Z"),
    };
    const { current } = await analyticsReportsService.getOverview(orgId, empty);
    expect(current).toMatchObject({ closes: 0, aiResolutionRate: null, handoffRate: null });
    const csat = await analyticsReportsService.getCsat(orgId, empty);
    expect(csat.current).toMatchObject({ rated: 0, average: null, responseRate: null });
  });

  it("csat: webchat conversations only, split by AI and team", async () => {
    const { current, previous, trend, lowScores } = await analyticsReportsService.getCsat(
      orgId,
      range,
    );

    expect(current.surveyed).toBe(6);
    expect(current.rated).toBe(3);
    expect(current.average).toBeCloseTo(10 / 3);
    expect(current.responseRate).toBe(50);
    expect(current.ai).toEqual({ surveyed: 4, rated: 2, average: 4.5 });
    expect(current.human).toEqual({ surveyed: 2, rated: 1, average: 1 });
    expect(current.distribution).toEqual([1, 0, 0, 1, 1]);

    expect(previous).toMatchObject({ surveyed: 2, rated: 1, average: 3 });

    expect(trend).toEqual([
      { date: "2026-10-10", rated: 2, average: 4.5 },
      { date: "2026-10-11", rated: 1, average: 1 },
    ]);

    expect(lowScores).toEqual([
      {
        conversationId: lowScoreConversationId,
        title: "Where is my refund?",
        rating: 1,
        ratedAt: day(11),
        handedOff: true,
      },
    ]);
  });

  it("hand-offs: reasons by category, old planned hand-offs still recognised", async () => {
    const { current, previous, reasons } = await analyticsReportsService.getHandoffs(orgId, range);

    expect(current.closes).toBe(7);
    expect(current.handedOff).toBe(3);
    expect(current.categories).toEqual({
      planned: 1,
      customer_asked: 0,
      fallback: 1,
      not_recorded: 1,
    });
    expect(reasons.map((r) => [r.reason, r.category, r.count])).toEqual([
      ["low_confidence", "fallback", 1],
      ["not_recorded", "not_recorded", 1],
      ["playbook", "planned", 1],
    ]);

    expect(previous.categories.customer_asked).toBe(1);
    expect(previous.handoffRate).toBe(50);
  });

  it("topics: folds case and spacing, reports coverage", async () => {
    const report = await analyticsReportsService.getTopics(orgId, range);

    expect(report.closes).toBe(7);
    expect(report.labelled).toBe(4);
    expect(report.topics).toEqual([
      {
        topic: "refund",
        closes: 2,
        aiResolved: 0,
        handedOff: 1,
        aiResolutionRate: 0,
        handoffRate: 50,
        csatRated: 1,
        csatAverage: 1,
      },
      {
        topic: "shipping",
        closes: 2,
        aiResolved: 2,
        handedOff: 0,
        aiResolutionRate: 100,
        handoffRate: 0,
        csatRated: 2,
        csatAverage: 4.5,
      },
    ]);
  });

  it("playbooks: one row per playbook, plus closes no playbook handled", async () => {
    const { playbooks } = await analyticsReportsService.getPlaybooks(orgId, range);

    expect(
      playbooks.map((p) => [p.playbookId, p.title, p.closes, p.aiResolutionRate, p.handoffRate]),
    ).toEqual([
      [null, null, 4, 0, 50],
      [playbookA, "Where is my order", 2, 100, 0],
      [playbookB, "Refund request", 1, 100, 100],
    ]);
    expect(playbooks[1]).toMatchObject({ csatRated: 2, csatAverage: 4.5 });
  });

  it("exports each report as CSV", async () => {
    const csv = (report: Parameters<typeof analyticsReportsService.exportCsv>[1]) =>
      analyticsReportsService.exportCsv(orgId, report, range);

    expect((await csv("overview")).split("\n")).toEqual([
      "date,closes,ai_resolved,ai_resolution_rate,handed_off,handoff_rate",
      "2026-10-10,2,2,100.0,0,0.0",
      "2026-10-11,2,0,0.0,1,50.0",
      "2026-10-12,2,1,50.0,2,100.0",
      "2026-10-13,1,0,0.0,0,0.0",
    ]);
    expect((await csv("csat")).split("\n")).toHaveLength(4);
    expect((await csv("csat")).split("\n")[1]).toBe(
      `${lowScoreConversationId},1,2026-10-11T12:00:00.000Z,human`,
    );
    expect((await csv("handoffs")).split("\n")[1]).toBe("low_confidence,fallback,1,33.3");
    expect((await csv("topics")).split("\n")[2]).toBe("shipping,2,2,100.0,0,0.0,2,4.50");
    expect((await csv("playbooks")).split("\n")[2]).toBe(
      `${playbookA},Where is my order,draft,2,2,100.0,0,0.0,2,4.50`,
    );
  });
});

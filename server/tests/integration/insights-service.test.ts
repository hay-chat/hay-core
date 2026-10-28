import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import {
  insightsService,
  canTransition,
  fixedStatus,
  archiveSuggested,
} from "../../services/insights/insights.service";

describe("insights service (D3-13)", () => {
  const orgId = "d3130000-0000-4000-8000-000000000001";
  const otherOrgId = "d3130000-0000-4000-8000-000000000002";
  const issues = () => AppDataSource.getRepository(InsightIssue);

  async function cluster(
    overrides: Record<string, unknown> = {},
    organizationId = orgId,
  ): Promise<string> {
    const row = {
      polarity: "negative",
      action_type: "knowledge_add",
      signature: "negative:knowledge",
      title: "Shipping to Portugal is not documented",
      summary: "Shoppers keep asking about Portugal.",
      state: "new",
      size: 6,
      window_size: 6,
      impact_score: 10,
      promoted_at: new Date(),
      last_seen_at: new Date(),
      snippets: JSON.stringify([
        {
          issueId: "00000000-0000-4000-8000-000000000000",
          conversationId: "00000000-0000-4000-8000-0000000000aa",
          source: "ai_review",
          text: "Do you ship to Portugal?",
        },
      ]),
      ...overrides,
    };
    const keys = Object.keys(row);
    const [inserted] = await AppDataSource.query(
      `INSERT INTO insight_clusters (organization_id, ${keys.join(", ")})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
      [organizationId, ...Object.values(row)],
    );
    return inserted.id;
  }

  async function member(clusterId: string, overrides: Partial<InsightIssue> = {}) {
    const saved = await issues().save(
      issues().create({
        organization_id: orgId,
        source: "ai_review",
        polarity: "negative",
        action_type: "knowledge_add",
        severity: "medium",
        confidence: 0.8,
        relevance: 60,
        summary: "Portugal shipping question",
        signals: { channel: "web" },
        ...overrides,
      }),
    );
    await AppDataSource.query(
      `INSERT INTO insight_cluster_members (insight_issue_id, cluster_id, organization_id, similarity)
       VALUES ($1, $2, $3, 0.9)`,
      [saved.id, clusterId, orgId],
    );
    return saved;
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "insights-service-org"],
      [otherOrgId, "insights-service-other-org"],
    ]) {
      if (!(await orgRepo.findOne({ where: { id } }))) {
        await orgRepo.save(orgRepo.create({ id, name: slug, slug }));
      }
    }
  });

  beforeEach(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await issues().delete({ organization_id: orgId });
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = ANY($1)`, [
      [orgId, otherOrgId],
    ]);
    await issues().delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete([orgId, otherOrgId]);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("lists promoted open clusters of the org only, with filters and counts", async () => {
    const negative = await cluster();
    const positive = await cluster({ polarity: "positive", signature: "positive:knowledge" });
    await cluster({ state: "addressed" });
    await cluster({ promoted_at: null }); // candidate, hidden
    await cluster({ last_seen_at: new Date(Date.now() - 60 * 86400000) }); // outside window
    await cluster({}, otherOrgId);
    await member(negative);

    const open = await insightsService.list(orgId, { days: 30 });
    expect(open.items.map((i) => i.id)).toEqual([negative, positive]); // negatives first
    expect(open.items[0].periodSize).toBe(1);
    expect(open.counts).toMatchObject({ open: 3, new: 3, positive: 1, addressed: 1 });

    const positives = await insightsService.list(orgId, { days: 30, polarity: "positive" });
    expect(positives.items.map((i) => i.id)).toEqual([positive]);

    const addressed = await insightsService.list(orgId, { days: 30, state: "addressed" });
    expect(addressed.items).toHaveLength(1);

    const bigOnly = await insightsService.list(orgId, { days: 30, minSize: 2 });
    expect(bigOnly.items).toHaveLength(0);
  });

  it("returns detail with breakdowns and nulls links to deleted conversations", async () => {
    const id = await cluster();
    await member(id);
    await member(id, { source: "user_feedback", signals: { channel: "whatsapp" } });

    const detail = await insightsService.get(orgId, id);
    expect(detail.snippets[0].conversationId).toBeNull();
    expect(detail.members).toHaveLength(2);
    expect(detail.breakdown.sources.map((s) => s.key).sort()).toEqual([
      "ai_review",
      "user_feedback",
    ]);
    expect(detail.allowedTransitions).toContain("acknowledged");
    await expect(insightsService.get(otherOrgId, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("moves through the lifecycle with an audit trail and rejects invalid moves", async () => {
    const id = await cluster();
    await insightsService.setState({
      organizationId: orgId,
      clusterId: id,
      to: "rejected",
      userId: null,
      reason: "  Not our policy  ",
    });
    await expect(
      insightsService.setState({
        organizationId: orgId,
        clusterId: id,
        to: "addressed",
        userId: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await insightsService.setState({
      organizationId: orgId,
      clusterId: id,
      to: "new",
      userId: null,
    });
    await insightsService.setState({
      organizationId: orgId,
      clusterId: id,
      to: "addressed",
      userId: null,
    });

    const detail = await insightsService.get(orgId, id);
    expect(detail.state).toBe("addressed");
    expect(detail.addressedAt).not.toBeNull();
    expect(detail.audit.map((a) => a.toState)).toEqual(["addressed", "new", "rejected"]);
    expect(detail.audit[2].reason).toBe("Not our policy");
    await expect(
      insightsService.setState({
        organizationId: otherOrgId,
        clusterId: id,
        to: "new",
        userId: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("approve opens the right reviewer and moves the insight to in progress (D3-14)", async () => {
    const [playbook] = await AppDataSource.query(
      `INSERT INTO playbooks (title, trigger, organization_id) VALUES ('Returns', 'returns', $1) RETURNING id`,
      [orgId],
    );
    const editId = await cluster({ action_type: "playbook_edit", signature: "negative:playbook" });
    await member(editId, { signals: { playbookId: playbook.id } });
    await member(editId, { signals: { playbookId: "00000000-0000-4000-8000-00000000dead" } });

    const edit = await insightsService.approve({
      organizationId: orgId,
      clusterId: editId,
      userId: null,
    });
    expect(edit).toMatchObject({ kind: "playbook_edit", playbookId: playbook.id });
    expect(edit.feedback).toContain("Shipping to Portugal is not documented");
    expect(edit.feedback).toContain("Do you ship to Portugal?");
    expect(edit.feedback.length).toBeLessThanOrEqual(4000);
    const detail = await insightsService.get(orgId, editId);
    expect(detail.state).toBe("in_progress");
    expect(detail.approvedAction).toMatchObject({ kind: "playbook_edit", playbookId: playbook.id });

    // No playbook to edit any more: falls back to a task, never a silent edit.
    const orphanId = await cluster({
      action_type: "playbook_edit",
      signature: "negative:playbook",
    });
    await member(orphanId, { signals: { playbookId: "00000000-0000-4000-8000-00000000dead" } });
    expect(
      (await insightsService.approve({ organizationId: orgId, clusterId: orphanId, userId: null }))
        .kind,
    ).toBe("task");

    const knowledgeId = await cluster();
    expect(
      (
        await insightsService.approve({
          organizationId: orgId,
          clusterId: knowledgeId,
          userId: null,
        })
      ).kind,
    ).toBe("knowledge");

    const bugId = await cluster({ action_type: "product_bug", signature: "negative:product" });
    expect(
      (await insightsService.approve({ organizationId: orgId, clusterId: bugId, userId: null }))
        .kind,
    ).toBe("task");

    const closedId = await cluster({ state: "addressed" });
    await expect(
      insightsService.approve({ organizationId: orgId, clusterId: closedId, userId: null }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await AppDataSource.query(`DELETE FROM playbooks WHERE id = $1`, [playbook.id]);
  });

  it("measures whether addressed insights stayed fixed and suggests archiving stale ones (D3-16)", async () => {
    const day = 86400000;
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * day);

    expect(fixedStatus(null, 3, 0)).toBeNull();
    expect(fixedStatus(ago(5), 8, 0, now)?.status).toBe("watching");
    expect(fixedStatus(ago(28), 8, 0, now)?.status).toBe("fixed");
    expect(fixedStatus(ago(28), 8, 3, now)?.status).toBe("improved"); // 0.75/wk vs 1.9/wk
    expect(fixedStatus(ago(28), 4, 8, now)?.status).toBe("not_fixed");
    expect(archiveSuggested("new", ago(50), now)).toBe(true);
    expect(archiveSuggested("new", ago(10), now)).toBe(false);
    expect(archiveSuggested("rejected", ago(50), now)).toBe(false);

    const fixedId = await cluster({ state: "addressed", addressed_at: ago(20) });
    for (let i = 0; i < 4; i++) {
      const m = await member(fixedId);
      await AppDataSource.query(`UPDATE insight_issues SET created_at = $2 WHERE id = $1`, [
        m.id,
        ago(25 + i),
      ]);
    }
    const brokenId = await cluster({ state: "new", addressed_at: ago(20) });
    for (const daysAgo of [25, 10, 5, 3, 1]) {
      const m = await member(brokenId);
      await AppDataSource.query(`UPDATE insight_issues SET created_at = $2 WHERE id = $1`, [
        m.id,
        ago(daysAgo),
      ]);
    }
    await cluster({ state: "addressed", addressed_at: ago(3) }); // still watching

    const { counts } = await insightsService.list(orgId, { days: 30, state: "all" });
    expect(counts).toMatchObject({ fixed: 1, measured: 2 });
    expect((await insightsService.get(orgId, fixedId)).fixed?.status).toBe("fixed");
    expect((await insightsService.get(orgId, brokenId)).fixed?.status).toBe("not_fixed");
  });

  it("encodes the transition table", () => {
    expect(canTransition("new", "addressed")).toBe(true);
    expect(canTransition("archived", "new")).toBe(true);
    expect(canTransition("archived", "addressed")).toBe(false);
    expect(canTransition("rejected", "in_progress")).toBe(false);
  });
});

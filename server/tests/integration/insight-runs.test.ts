import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import { insightRunsService } from "../../services/insights/insight-runs.service";
import { estimateCostUsd } from "../../services/insights/llm-pricing";

describe("insight runs ledger and metrics (D3-11)", () => {
  const orgId = "d3110000-0000-4000-8000-000000000001";
  const otherOrgId = "d3110000-0000-4000-8000-000000000002";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "insight-runs-org"],
      [otherOrgId, "insight-runs-other"],
    ]) {
      if (!(await orgs.findOne({ where: { id } }))) {
        await orgs.save(orgs.create({ id, name: slug, slug }));
      }
    }
  });

  beforeEach(async () => {
    for (const org of [orgId, otherOrgId]) {
      await AppDataSource.query(`DELETE FROM insight_runs WHERE organization_id = $1`, [org]);
      await AppDataSource.getRepository(InsightIssue).delete({ organization_id: org });
    }
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await AppDataSource.getRepository(InsightIssue).delete({ organization_id: org });
      await AppDataSource.getRepository(Organization).delete({ id: org });
    }
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("prices known models (dated ids, cached input) and leaves unknown ones null", () => {
    const usage = { promptTokens: 1_000_000, cachedPromptTokens: 0, completionTokens: 1_000_000 };
    expect(estimateCostUsd("claude-haiku-4-5", usage)).toBe(6);
    expect(estimateCostUsd("gpt-4o-mini-2024-07-18", usage)).toBe(0.75);
    expect(
      estimateCostUsd("claude-sonnet-4-6", {
        promptTokens: 1_000_000,
        cachedPromptTokens: 500_000,
        completionTokens: 0,
      }),
    ).toBe(1.65);
    expect(estimateCostUsd("gemini-2.5-flash", usage)).toBeNull();
    expect(estimateCostUsd(null, usage)).toBeNull();
  });

  it("aggregates runs, failures, durations, cost and daily issues per organization", async () => {
    const usage = { promptTokens: 1000, cachedPromptTokens: 0, completionTokens: 200 };
    await insightRunsService.record({
      organizationId: orgId,
      kind: "close_classification",
      model: "gpt-4o-mini",
      usage,
      durationMs: 1200,
      succeeded: true,
    });
    await insightRunsService.record({
      organizationId: orgId,
      kind: "close_classification",
      model: null,
      usage: null,
      durationMs: 300,
      succeeded: false,
    });
    await insightRunsService.record({
      organizationId: orgId,
      kind: "embedding",
      model: "mystery-embedder",
      usage: { promptTokens: 80, cachedPromptTokens: 0, completionTokens: 0 },
      durationMs: 90,
      succeeded: true,
      items: 4,
    });
    await insightRunsService.record({
      organizationId: otherOrgId,
      kind: "feedback_enrichment",
      model: "gpt-4o-mini",
      usage,
      durationMs: 500,
      succeeded: true,
    });
    const issues = AppDataSource.getRepository(InsightIssue);
    for (const source of ["ai_review", "user_feedback", "user_feedback"] as const) {
      await issues.save(
        issues.create({
          organization_id: orgId,
          source,
          polarity: "negative",
          action_type: "knowledge_add",
          severity: "medium",
          confidence: 0.5,
          relevance: 30,
          summary: "s",
          // Pending and leased far ahead, so the parallel enrichment and
          // embedding tests (global jobs) never touch these rows.
          enriched_at: null,
          enrich_claimed_until: new Date(Date.now() + 3_600_000),
        }),
      );
    }

    const metrics = await insightRunsService.getMetrics(orgId, 30);
    expect(metrics.pendingEnrichment).toBe(3);
    expect(metrics.issuesPerDay.map((d) => [d.source, d.count])).toEqual([
      ["ai_review", 1],
      ["user_feedback", 2],
    ]);
    const classification = metrics.jobs.find((j) => j.kind === "close_classification")!;
    expect(classification).toMatchObject({ runs: 2, failures: 1, promptTokens: 1000 });
    expect(classification.estimatedCostUsd).toBeCloseTo(0.00027, 6);
    expect(metrics.jobs.find((j) => j.kind === "embedding")).toMatchObject({
      items: 4,
      unpricedRuns: 1,
      estimatedCostUsd: 0,
    });
    expect(metrics.jobs.find((j) => j.kind === "feedback_enrichment")).toBeUndefined();
    expect(metrics.totalEstimatedCostUsd).toBeCloseTo(0.00027, 6);
  });
});

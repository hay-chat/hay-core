import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import {
  InsightClusteringService,
  assignIssues,
  mergeClusters,
  passesPromotionGate,
  impactScore,
  recurrenceThreshold,
  type WorkingCluster,
} from "../../services/insights/insight-clustering.service";
import { resolveThresholds } from "../../services/insights/insight-settings";

const mockInvoke = jest.fn<() => Promise<unknown>>();

// The LLM is the boundary; SQL and pgvector run for real.
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({
    invokeWithMeta: (...args: unknown[]) => (mockInvoke as (...a: unknown[]) => unknown)(...args),
  })),
}));

/** A unit-ish vector pointing along axis `k`, nudged by `jitter` on axis k+1. */
const dir = (k: number, jitter = 0): number[] => {
  const v = new Array(1536).fill(0);
  v[k] = 1;
  v[k + 1] = jitter;
  return v;
};

describe("insight clustering (D3-12, D3-16)", () => {
  const orgId = "d3120000-0000-4000-8000-000000000001";
  const issues = () => AppDataSource.getRepository(InsightIssue);
  const service = new InsightClusteringService();

  async function issue(
    vector: number[],
    overrides: Partial<InsightIssue> = {},
    createdAt?: Date,
  ): Promise<InsightIssue> {
    const saved = await issues().save(
      issues().create({
        organization_id: orgId,
        source: "ai_review",
        polarity: "negative",
        action_type: "knowledge_add",
        severity: "medium",
        confidence: 0.8,
        relevance: 60,
        summary: "Shopper asked about shipping to Portugal; no document covers it.",
        area: "shipping",
        paraphrase: "Do you ship to Portugal?",
        snippet: "Do you ship to Portugal?",
        enriched_at: new Date(),
        ...overrides,
      }),
    );
    if (createdAt) {
      await AppDataSource.query(`UPDATE insight_issues SET created_at = $2 WHERE id = $1`, [
        saved.id,
        createdAt,
      ]);
    }
    await AppDataSource.query(
      `INSERT INTO insight_issue_embeddings (organization_id, insight_issue_id, content, model, embedding)
       VALUES ($1, $2, 'x', 'test', $3::vector)`,
      [orgId, saved.id, `[${vector.join(",")}]`],
    );
    return saved;
  }

  const clusters = (): Promise<
    Array<{
      id: string;
      polarity: string;
      size: number;
      window_size: number;
      promoted_at: Date | null;
      title: string | null;
      state: string;
      merged_into_id: string | null;
      snippets: unknown[];
    }>
  > =>
    AppDataSource.query(
      `SELECT id, polarity, size, window_size, promoted_at, title, state, merged_into_id, snippets
         FROM insight_clusters WHERE organization_id = $1 ORDER BY size DESC`,
      [orgId],
    );

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({
          id: orgId,
          name: "Insight Clustering Org",
          slug: "insight-clustering-org",
        }),
      );
    }
  });

  beforeEach(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await issues().delete({ organization_id: orgId });
    await AppDataSource.query(`DELETE FROM insight_runs WHERE organization_id = $1`, [orgId]);
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      content: JSON.stringify({
        title: "Shipping to Portugal is not documented",
        summary: "Shoppers keep asking about Portugal.",
        hypothesis: "Add a shipping document that lists Portugal.",
      }),
      model: "gpt-4o-mini",
      usage: { promptTokens: 100, cachedPromptTokens: 0, completionTokens: 30, totalTokens: 130 },
    });
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await issues().delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("joins similar issues, keeps polarities apart, promotes at the minimum size and names it", async () => {
    for (let i = 0; i < 5; i++) await issue(dir(10, i * 0.05));
    await issue(dir(10, 0.3), { severity: "high" });
    await issue(dir(10, 0.1), { polarity: "positive", summary: "Clear shipping answer" });
    await issue(dir(10, 0.15), { polarity: "positive", summary: "Clear shipping answer" });
    await issue(dir(200)); // unrelated topic

    const result = await service.clusterOrganization(orgId);
    expect(result).toMatchObject({ assigned: 9, created: 3, promoted: 1, named: 1 });

    const rows = await clusters();
    const negative = rows.find((c) => c.polarity === "negative" && c.size === 6)!;
    expect(negative.promoted_at).not.toBeNull();
    expect(negative.title).toBe("Shipping to Portugal is not documented");
    expect(negative.snippets).toHaveLength(1); // identical snippets are deduplicated
    const positive = rows.find((c) => c.polarity === "positive")!;
    expect(positive.size).toBe(2);
    expect(positive.promoted_at).toBeNull();

    const [run] = await AppDataSource.query(
      `SELECT kind, succeeded FROM insight_runs WHERE organization_id = $1`,
      [orgId],
    );
    expect(run).toEqual({ kind: "cluster_naming", succeeded: true });

    // Idempotent: a second run assigns nothing and does not rename.
    const again = await service.clusterOrganization(orgId);
    expect(again).toMatchObject({ assigned: 0, created: 0, named: 0 });
  });

  it("falls back to a deterministic title when the LLM fails", async () => {
    mockInvoke.mockRejectedValue(new Error("provider down"));
    for (let i = 0; i < 5; i++) await issue(dir(20, i * 0.05), { severity: "high" });
    await service.clusterOrganization(orgId);
    const [cluster] = await clusters();
    expect(cluster.title).toContain("Portugal");
  });

  it("merges clusters with the same signature only", async () => {
    // Two clusters from separate runs whose centroids end up close.
    await issue(dir(30, 0));
    await service.clusterOrganization(orgId, { nameClusters: false });
    await AppDataSource.query(
      `INSERT INTO insight_clusters (organization_id, polarity, action_type, signature, centroid, size)
       VALUES ($1, 'negative', 'knowledge_add', 'negative:knowledge_add', $2::vector, 0),
              ($1, 'negative', 'playbook_edit', 'negative:playbook_edit', $2::vector, 0)`,
      [orgId, `[${dir(30, 0.02).join(",")}]`],
    );
    await issue(dir(40)); // something to trigger a run
    const result = await service.clusterOrganization(orgId, { nameClusters: false });
    expect(result.merged).toBe(1);
    const rows = await clusters();
    expect(rows.filter((c) => c.merged_into_id !== null)).toHaveLength(1);
    // The playbook_edit cluster survives: different signature.
    const [{ count }] = await AppDataSource.query(
      `SELECT count(*)::int AS count FROM insight_clusters
        WHERE organization_id = $1 AND action_type = 'playbook_edit' AND merged_into_id IS NULL`,
      [orgId],
    );
    expect(count).toBe(1);
    const [audit] = await AppDataSource.query(
      `SELECT reason FROM insight_state_audit WHERE organization_id = $1`,
      [orgId],
    );
    expect(audit.reason).toMatch(/^merged:/);
  });

  it("reopens an addressed cluster when the pattern comes back", async () => {
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    for (let i = 0; i < 5; i++) await issue(dir(50, i * 0.05), { severity: "high" }, old);
    await service.clusterOrganization(orgId, { nameClusters: false });
    const [cluster] = await clusters();
    await AppDataSource.query(
      `UPDATE insight_clusters SET state = 'addressed', addressed_at = now() - interval '5 days' WHERE id = $1`,
      [cluster.id],
    );

    await issue(dir(50, 0.01));
    await issue(dir(50, 0.02));
    let result = await service.clusterOrganization(orgId, { nameClusters: false });
    expect(result.recurred).toBe(0); // 2 < threshold 3 for min size 5

    await issue(dir(50, 0.03));
    result = await service.clusterOrganization(orgId, { nameClusters: false });
    expect(result.recurred).toBe(1);
    const [reopened] = await clusters();
    expect(reopened.state).toBe("new");
    const audit = await AppDataSource.query(
      `SELECT from_state, to_state, reason, user_id FROM insight_state_audit WHERE cluster_id = $1`,
      [cluster.id],
    );
    expect(audit).toEqual([
      { from_state: "addressed", to_state: "new", reason: "recurred", user_id: null },
    ]);
  });

  it("respects a per-organization minimum size", async () => {
    await AppDataSource.query(
      `UPDATE organizations SET settings = coalesce(settings, '{}'::jsonb) || '{"insights":{"minClusterSize":3}}'::jsonb WHERE id = $1`,
      [orgId],
    );
    try {
      for (let i = 0; i < 3; i++) await issue(dir(60, i * 0.05), { severity: "high" });
      const result = await service.clusterOrganization(orgId, { nameClusters: false });
      expect(result.promoted).toBe(1);
    } finally {
      await AppDataSource.query(
        `UPDATE organizations SET settings = settings - 'insights' WHERE id = $1`,
        [orgId],
      );
    }
  });
});

describe("clustering helpers", () => {
  const working = (key: string, centroid: number[], over: Partial<WorkingCluster> = {}) => ({
    id: key,
    key,
    polarity: "negative",
    actionType: "knowledge_add",
    area: null,
    centroid,
    size: 1,
    mergedInto: null,
    ...over,
  });

  it("assigns to the best cluster above the join threshold, else creates one", () => {
    const clusters: WorkingCluster[] = [working("a", dir(1)), working("b", dir(5))];
    let n = 0;
    const out = assignIssues(
      [
        { id: "i1", polarity: "negative", actionType: "x", area: null, vector: dir(1, 0.1) },
        { id: "i2", polarity: "positive", actionType: "x", area: null, vector: dir(1, 0.1) },
        { id: "i3", polarity: "negative", actionType: "x", area: null, vector: dir(9) },
      ],
      clusters,
      0.86,
      () => `n${n++}`,
    );
    expect(out.map((a) => a.clusterKey)).toEqual(["a", "n0", "n1"]);
    expect(clusters.find((c) => c.key === "a")!.size).toBe(2);
  });

  it("merges the smaller cluster into the larger", () => {
    const clusters: WorkingCluster[] = [
      working("big", dir(1), { size: 5 }),
      working("small", dir(1, 0.05), { size: 2 }),
      working("other", dir(1, 0.05), { actionType: "playbook_edit" }),
    ];
    expect(mergeClusters(clusters, 0.91)).toEqual([
      { fromKey: "small", intoKey: "big", similarity: expect.any(Number) },
    ]);
    expect(clusters[0].size).toBe(7);
  });

  it("gates promotion on size plus one signal; positives need size only", () => {
    const base = {
      polarity: "negative",
      windowSize: 5,
      negativeCount: 1,
      highSeverityCount: 0,
      feedbackNegativeCount: 0,
      avgRelevance: 40,
    };
    expect(passesPromotionGate(base, 5)).toBe(false);
    expect(passesPromotionGate({ ...base, avgRelevance: 55 }, 5)).toBe(true);
    expect(passesPromotionGate({ ...base, negativeCount: 3 }, 5)).toBe(true);
    expect(passesPromotionGate({ ...base, feedbackNegativeCount: 1 }, 5)).toBe(true);
    expect(passesPromotionGate({ ...base, windowSize: 4, highSeverityCount: 4 }, 5)).toBe(false);
    expect(passesPromotionGate({ ...base, polarity: "positive" }, 5)).toBe(true);
    expect(impactScore({ ...base, highSeverityCount: 5 })).toBeGreaterThan(impactScore(base));
    expect(recurrenceThreshold(5, "clustering")).toBe(3);
    expect(recurrenceThreshold(10, "docs_audit")).toBe(1);
  });

  it("clamps per-organization thresholds", () => {
    expect(resolveThresholds({ minClusterSize: 1, joinThreshold: 2, mergeThreshold: 0.5 })).toEqual(
      expect.objectContaining({ minClusterSize: 2, joinThreshold: 0.98, mergeThreshold: 0.98 }),
    );
    expect(resolveThresholds(undefined)).toEqual(
      expect.objectContaining({ minClusterSize: 5, joinThreshold: 0.86, mergeThreshold: 0.91 }),
    );
  });
});

import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { InsightIssue } from "../../database/entities/insight-issue.entity";
import {
  InsightEmbeddingService,
  insightEmbeddingText,
} from "../../services/insights/insight-embedding.service";

const mockEmbed = jest.fn<(req: { input: string[] }) => Promise<unknown>>();

// The embedding provider is the boundary; SQL and pgvector run for real.
jest.mock("../../services/llm/llm-provider.factory", () => ({
  llmProviderFactory: {
    forOrganization: async () => ({ embedding: { embed: mockEmbed }, region: "us" }),
  },
}));

const vector = (seed: number) => Array.from({ length: 1536 }, (_, i) => ((i + seed) % 7) / 7);

describe("insight issue embeddings (D3-7)", () => {
  const orgId = "d3700000-0000-4000-8000-000000000001";
  const issues = () => AppDataSource.getRepository(InsightIssue);

  async function issue(overrides: Partial<InsightIssue> = {}): Promise<InsightIssue> {
    return issues().save(
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
        snippet: "verbatim text",
        enriched_at: new Date(),
        ...overrides,
      }),
    );
  }

  const embeddingRows = (): Promise<Array<{ insight_issue_id: string; content: string }>> =>
    AppDataSource.query(
      `SELECT insight_issue_id, content FROM insight_issue_embeddings WHERE organization_id = $1`,
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
          name: "Insight Embeddings Org",
          slug: "insight-embeddings-org",
        }),
      );
    }
  });

  beforeEach(async () => {
    await issues().delete({ organization_id: orgId });
    mockEmbed.mockReset();
    mockEmbed.mockImplementation(async (req) => ({
      embeddings: req.input.map((_, i) => vector(i)),
      usage: { promptTokens: 40, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 40 },
      model: "text-embedding-3-small",
      provider: "openai",
      dimensions: 1536,
    }));
  });

  afterAll(async () => {
    await issues().delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("embeds enriched issues once, from redacted issue text without the snippet", async () => {
    const enriched = await issue();
    const pending = await issue({ source: "user_feedback", enriched_at: null });

    const service = new InsightEmbeddingService();
    const [run] = (await service.embedPending(50)).filter((r) => r.organizationId === orgId);
    expect(run).toMatchObject({ embedded: 1, error: null });

    const rows = await embeddingRows();
    expect(rows.map((r) => r.insight_issue_id)).toEqual([enriched.id]);
    expect(rows[0].content).toContain("Area: shipping");
    expect(rows[0].content).not.toContain("verbatim text");
    expect(rows.find((r) => r.insight_issue_id === pending.id)).toBeUndefined();

    // Nothing left to do for this org: no second embedding.
    const again = (await service.embedPending(50)).filter((r) => r.organizationId === orgId);
    expect(again).toEqual([]);
  });

  it("pauses an organization whose provider fails, and cascades with the issue", async () => {
    const failing = await issue();
    mockEmbed.mockRejectedValue(new Error("provider down"));
    const service = new InsightEmbeddingService();
    const [run] = (await service.embedPending(50)).filter((r) => r.organizationId === orgId);
    expect(run.error).toBe("provider down");
    // Paused: the next run does not retry it straight away.
    expect((await service.embedPending(50)).filter((r) => r.organizationId === orgId)).toEqual([]);

    const fresh = new InsightEmbeddingService();
    mockEmbed.mockReset();
    mockEmbed.mockImplementation(async (req) => ({
      embeddings: req.input.map(() => vector(1)),
      usage: { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 0, totalTokens: 1 },
      model: "m",
      provider: "p",
      dimensions: 1536,
    }));
    await fresh.embedPending(50);
    expect(await embeddingRows()).toHaveLength(1);
    await issues().delete({ id: failing.id });
    expect(await embeddingRows()).toHaveLength(0);
  });

  it("builds the embedding text from what happened, not who", () => {
    expect(
      insightEmbeddingText({
        id: "x",
        organization_id: orgId,
        action_type: "playbook_edit",
        area: null,
        summary: "The AI promised a refund it cannot give.",
        root_cause: "Playbook says refunds are automatic.",
        paraphrase: null,
        detail: "",
      }),
    ).toBe(
      "Action: playbook_edit\nThe AI promised a refund it cannot give.\nRoot cause: Playbook says refunds are automatic.",
    );
  });
});

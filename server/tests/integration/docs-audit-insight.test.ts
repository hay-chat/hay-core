import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import type { AuditResult } from "../../services/docs-audit.service";

const mockTools = jest.fn<() => Promise<unknown[]>>();

jest.mock("../../services/mcp-registry.service", () => ({
  mcpRegistryService: { getToolsForOrg: () => mockTools() },
}));
// The docs audit's LLM is never reached in these tests.
jest.mock("../../services/core/llm.service", () => ({
  LLMService: jest.fn().mockImplementation(() => ({})),
}));

import {
  DocsAuditInsightService,
  findingsFromAudit,
} from "../../services/insights/docs-audit-insight.service";
import { insightsService } from "../../services/insights/insights.service";

const audit = (score: number): AuditResult => ({
  overallScore: score,
  summary: "",
  documentCount: 3,
  auditedAt: new Date().toISOString(),
  dimensions: [
    {
      dimension: "Coverage & Gaps",
      score,
      weight: 1,
      findings: [
        { type: "negative", title: "No returns policy for Portugal", detail: "Missing." },
        { type: "positive", title: "Shipping is clear", detail: "Good." },
      ],
      recommendations: ["Add a returns document for Portugal."],
    },
    {
      dimension: "Content Quality",
      score,
      weight: 1,
      findings: [
        {
          type: "negative",
          title: "Outdated prices",
          detail: "Prices differ.",
          affectedDocs: ["Pricing"],
        },
      ],
      recommendations: [],
    },
  ],
});

const actionDoc = (action: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "mention", attrs: { id: action, type: "action", label: "refund" } }],
    },
  ],
});

describe("docs audit as an insights input (D3-15)", () => {
  const orgId = "d3150000-0000-4000-8000-000000000001";
  const service = new DocsAuditInsightService();

  const clusters = (): Promise<
    Array<{ id: string; dedupe_key: string; size: number; promoted_at: Date | null; state: string }>
  > =>
    AppDataSource.query(
      `SELECT id, dedupe_key, size, promoted_at, state FROM insight_clusters
        WHERE organization_id = $1 ORDER BY dedupe_key`,
      [orgId],
    );

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({ id: orgId, name: "Docs Audit Org", slug: "docs-audit-org" }),
      );
    }
  });

  beforeEach(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_issues WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM playbooks WHERE organization_id = $1`, [orgId]);
    mockTools.mockReset();
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_issues WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM playbooks WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_org_state WHERE organization_id = $1`, [orgId]);
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("keeps negative findings of weak dimensions only, with stable keys", () => {
    expect(findingsFromAudit(audit(85))).toEqual([]);
    const findings = findingsFromAudit(audit(40));
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      dedupeKey: "docs:coverage-gaps:no-returns-policy-for-portugal",
      actionType: "knowledge_add",
      severity: "high",
      hypothesis: "Add a returns document for Portugal.",
    });
    expect(findings[1]).toMatchObject({ actionType: "knowledge_edit" });
    expect(findings[1].detail).toContain("Pricing");
  });

  it("files each finding into one promoted insight that grows and recurs after addressed", async () => {
    const [finding] = findingsFromAudit(audit(40));
    const first = await service.recordFinding(orgId, finding);
    let [row] = await clusters();
    expect(row).toMatchObject({ id: first, size: 1, state: "new" });
    expect(row.promoted_at).not.toBeNull();

    expect(await service.recordFinding(orgId, finding)).toBe(first);
    [row] = await clusters();
    expect(row.size).toBe(2);

    await insightsService.setState({
      organizationId: orgId,
      clusterId: first,
      to: "addressed",
      userId: null,
    });
    await service.recordFinding(orgId, finding);
    [row] = await clusters();
    expect(row.state).toBe("new"); // the next audit still found it

    // Docs-audit issues never enter the embedding/clustering pipeline.
    const detail = await insightsService.get(orgId, first);
    expect(detail.title).toBe("No returns policy for Portugal");
    expect(detail.origin).toBe("docs_audit");
  });

  it("flags active playbooks that reference unavailable actions, and stays quiet without tools", async () => {
    await AppDataSource.query(
      `INSERT INTO playbooks (title, trigger, organization_id, status, instructions)
       VALUES ('Refunds', 'refund', $1, 'active', $2), ('Draft', 'x', $1, 'draft', $2)`,
      [orgId, JSON.stringify(actionDoc("shopify:create_refund"))],
    );

    mockTools.mockResolvedValue([]);
    expect(await service.brokenActionFindings(orgId)).toEqual([]);

    mockTools.mockResolvedValue([{ pluginId: "shopify", name: "get_order" }]);
    const broken = await service.brokenActionFindings(orgId);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ actionType: "setup", severity: "high" });
    expect(broken[0].dedupeKey).toMatch(/^actions:.+:shopify:create_refund$/);

    mockTools.mockResolvedValue([{ pluginId: "shopify", name: "create_refund" }]);
    expect(await service.brokenActionFindings(orgId)).toEqual([]);
  });
});

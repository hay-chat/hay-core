import { AppDataSource } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { jobRepository } from "@server/repositories/job.repository";
import { JobStatus, JobPriority } from "@server/entities/job.entity";
import { PlaybookStatus } from "@server/database/entities/playbook.entity";
import type { PlaybookInstructions } from "@server/database/entities/playbook.entity";
import type { AuditResult } from "@server/services/docs-audit.service";
import type { InsightActionType } from "@server/services/close-classification/outcome-rules";
import { insightClusteringService } from "./insight-clustering.service";
import { insightRunsService } from "./insight-runs.service";
import type { TokenUsage } from "./llm-pricing";
import { withUsageCollector, type UsageEvent } from "@server/services/llm/usage-sink";
import { DOCS_AUDIT_SCORE_THRESHOLD, getOrganizationThresholds } from "./insight-settings";

const logger = createLogger("docs-audit-insights");

/** A finding the weekly audit turns into an insight (source docs_audit). */
export interface DocsAuditFinding {
  /** Stable per finding so the same gap lands in the same insight every week. */
  dedupeKey: string;
  actionType: Extract<InsightActionType, "setup" | "knowledge_edit" | "knowledge_add">;
  severity: "medium" | "high";
  title: string;
  detail: string;
  hypothesis: string | null;
  area: string;
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

/**
 * Negative findings in dimensions scoring under the threshold. Coverage gaps
 * become knowledge_add; everything else about the documents is knowledge_edit.
 */
export function findingsFromAudit(audit: AuditResult): DocsAuditFinding[] {
  const findings: DocsAuditFinding[] = [];
  for (const dimension of audit.dimensions) {
    if (dimension.score >= DOCS_AUDIT_SCORE_THRESHOLD) continue;
    const isCoverage = /coverage|gap/i.test(dimension.dimension);
    for (const finding of dimension.findings) {
      if (finding.type !== "negative" || !finding.title?.trim()) continue;
      const affected = finding.affectedDocs?.length
        ? `\n${finding.affectedDocs.slice(0, 5).join(", ")}`
        : "";
      findings.push({
        dedupeKey: `docs:${normalize(dimension.dimension)}:${normalize(finding.title)}`,
        actionType: isCoverage ? "knowledge_add" : "knowledge_edit",
        severity: dimension.score < 50 ? "high" : "medium",
        title: finding.title.trim().slice(0, 200),
        detail: `${finding.detail ?? ""}${affected}`.trim().slice(0, 2000),
        hypothesis: dimension.recommendations[0]?.slice(0, 1000) ?? null,
        area: dimension.dimension.slice(0, 64),
      });
    }
  }
  return findings;
}

/**
 * D3-15: the weekly docs audit as an insights input. Two checks per org:
 * playbooks that reference actions no tool provides (setup), and the docs
 * quality audit (knowledge_edit / knowledge_add). Each finding is an
 * insight_issue (source docs_audit) in a cluster keyed by its dedupe key, so a
 * gap that persists grows the same insight and one that comes back after
 * "addressed" recurs.
 */
export class DocsAuditInsightService {
  /** Orgs with documents or playbooks and a conversation in the last 30 days. */
  async organizationsToAudit(): Promise<string[]> {
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `SELECT o.id FROM organizations o
        WHERE EXISTS (SELECT 1 FROM conversations c
                       WHERE c.organization_id = o.id
                         AND c.created_at >= now() - interval '30 days')
          AND (EXISTS (SELECT 1 FROM documents d WHERE d.organization_id = o.id)
               OR EXISTS (SELECT 1 FROM playbooks p WHERE p.organization_id = o.id))`,
    );
    return rows.map((r) => r.id);
  }

  async runAll(): Promise<void> {
    for (const organizationId of await this.organizationsToAudit()) {
      try {
        await this.auditOrganization(organizationId);
      } catch (error) {
        logger.error({ err: error, organizationId }, "Weekly docs audit failed");
      }
    }
  }

  async auditOrganization(organizationId: string): Promise<{ findings: number }> {
    const started = Date.now();
    // The audit's LLM calls are recorded on its insight run (F6), like the other jobs.
    const usage: TokenUsage = { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 };
    let model: string | null = null;
    const collect = (event: UsageEvent) => {
      if (event.kind !== "chat") return;
      usage.promptTokens += event.usage.promptTokens || 0;
      usage.cachedPromptTokens += event.usage.cachedPromptTokens || 0;
      usage.completionTokens += event.usage.completionTokens || 0;
      model = event.model;
    };
    const record = (succeeded: boolean, items: number) =>
      insightRunsService.record({
        organizationId,
        kind: "docs_audit",
        model,
        usage: model ? usage : null,
        durationMs: Date.now() - started,
        succeeded,
        items,
      });

    let findings: DocsAuditFinding[];
    try {
      findings = await withUsageCollector(collect, async () => [
        ...(await this.brokenActionFindings(organizationId)),
        ...(await this.documentFindings(organizationId)),
      ]);
    } catch (error) {
      await record(false, 0);
      throw error;
    }
    for (const finding of findings) {
      await this.recordFinding(organizationId, finding);
    }
    await AppDataSource.query(
      `INSERT INTO insight_org_state (organization_id, docs_audit_last_run_at)
       VALUES ($1, now())
       ON CONFLICT (organization_id) DO UPDATE SET docs_audit_last_run_at = now(), updated_at = now()`,
      [organizationId],
    );
    await record(true, findings.length);
    return { findings: findings.length };
  }

  /** Active playbooks whose `[action](plugin:tool)` references resolve to no tool. */
  async brokenActionFindings(organizationId: string): Promise<DocsAuditFinding[]> {
    const { mcpRegistryService } = await import("@server/services/mcp-registry.service");
    const tools = await mcpRegistryService.getToolsForOrg(organizationId).catch(() => []);
    // No tools cached at all: cannot tell a broken reference from a cold cache.
    if (tools.length === 0) return [];

    const { PlaybookService } = await import("@server/services/playbook.service");
    const playbookService = new PlaybookService();
    const playbooks: Array<{ id: string; title: string; instructions: PlaybookInstructions }> =
      await AppDataSource.query(
        `SELECT id, title, instructions FROM playbooks
          WHERE organization_id = $1 AND status = $2`,
        [organizationId, PlaybookStatus.ACTIVE],
      );
    const findings: DocsAuditFinding[] = [];
    for (const playbook of playbooks) {
      const unresolved = await playbookService.findUnresolvedActions(
        organizationId,
        playbook.instructions,
      );
      for (const action of unresolved ?? []) {
        findings.push({
          dedupeKey: `actions:${playbook.id}:${action}`.slice(0, 200),
          actionType: "setup",
          severity: "high",
          title: `Playbook "${playbook.title}" uses an action that is not available: ${action}`,
          detail: `The playbook "${playbook.title}" tells the AI to use "${action}", but no connected app provides it, so the AI cannot run it.`,
          hypothesis:
            "Reconnect or enable the app that provides this action, or edit the playbook to use an available action.",
          area: "actions",
        });
      }
    }
    return findings;
  }

  /** Runs the existing docs quality audit (tracked as a job) and keeps its weak spots. */
  async documentFindings(organizationId: string): Promise<DocsAuditFinding[]> {
    const [{ count }] = await AppDataSource.query(
      `SELECT count(*)::int AS count FROM documents WHERE organization_id = $1`,
      [organizationId],
    );
    if (Number(count) === 0) return [];

    const job = await jobRepository.create({
      title: "Weekly documentation audit",
      description: "Scheduled docs audit feeding Insights",
      status: JobStatus.PROCESSING,
      priority: JobPriority.LOW,
      organizationId,
      data: { type: "docs_audit", stage: "starting", scheduled: true },
    });
    const { docsAuditService } = await import("@server/services/docs-audit.service");
    const audit = await docsAuditService.runAudit(organizationId, job.id);
    return findingsFromAudit(audit);
  }

  /** One issue per finding per run, in the cluster that owns its dedupe key. */
  async recordFinding(organizationId: string, finding: DocsAuditFinding): Promise<string> {
    const thresholds = await getOrganizationThresholds(organizationId);
    return AppDataSource.transaction(async (manager) => {
      const [issue] = await manager.query(
        `INSERT INTO insight_issues
           (organization_id, source, polarity, action_type, severity, confidence, relevance,
            summary, root_cause, area, detail, snippet, signals, enriched_at)
         VALUES ($1, 'docs_audit', 'negative', $2, $3, 0.7, $4, $5, $6, $7, $8, $9, $10, now())
         RETURNING id`,
        [
          organizationId,
          finding.actionType,
          finding.severity,
          finding.severity === "high" ? 80 : 60,
          finding.title,
          finding.hypothesis,
          finding.area,
          finding.detail,
          finding.detail.slice(0, 300) || finding.title,
          JSON.stringify({ dedupeKey: finding.dedupeKey }),
        ],
      );
      const [cluster] = await manager.query(
        `INSERT INTO insight_clusters
           (organization_id, origin, dedupe_key, polarity, action_type, area, signature,
            title, summary, hypothesis, named_at, named_size)
         VALUES ($1, 'docs_audit', $2, 'negative', $3, $4, $5, $6, $7, $8, now(), 1)
         ON CONFLICT (organization_id, dedupe_key) WHERE dedupe_key IS NOT NULL
         DO UPDATE SET summary = EXCLUDED.summary, hypothesis = EXCLUDED.hypothesis,
                       updated_at = now()
         RETURNING id`,
        [
          organizationId,
          finding.dedupeKey,
          finding.actionType,
          finding.area,
          `negative:${finding.actionType}`,
          finding.title.slice(0, 200),
          finding.detail.slice(0, 1000) || null,
          finding.hypothesis,
        ],
      );
      await manager.query(
        `INSERT INTO insight_cluster_members (insight_issue_id, cluster_id, organization_id, similarity)
         VALUES ($1, $2, $3, 1)`,
        [issue.id, cluster.id, organizationId],
      );
      await insightClusteringService.refreshCluster(manager, cluster.id, thresholds);
      return cluster.id as string;
    });
  }
}

export const docsAuditInsightService = new DocsAuditInsightService();

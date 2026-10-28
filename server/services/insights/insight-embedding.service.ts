/**
 * Insight issue embeddings (D3-7): one vector per enriched insight issue, in
 * the `insight_issue_embeddings` sibling table (pgvector 1536, HNSW cosine),
 * for the clustering job of Insights phase 2.
 *
 * The `insight-embeddings` scheduled job calls `embedPending`, which picks
 * enriched issues with no embedding yet, embeds them per organization
 * through the org's managed embedding provider (same model and dimension as
 * the knowledge and product stores) and inserts them idempotently (unique
 * issue id, ON CONFLICT DO NOTHING). Only redacted issue text is embedded.
 */
import { AppDataSource } from "@server/database/data-source";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { llmProviderFactory } from "@server/services/llm/llm-provider.factory";
import { emitUsage } from "@server/services/llm/usage-sink";

const logger = createLogger("insight-embeddings");

/** A provider failure pauses that organization for this long (in-process). */
const ORG_BACKOFF_MS = 10 * 60 * 1000;

export interface EmbeddableIssue {
  id: string;
  organization_id: string;
  action_type: string;
  area: string | null;
  summary: string;
  root_cause: string | null;
  paraphrase: string | null;
  detail: string | null;
}

/**
 * The text that represents an issue in vector space: what happened and why,
 * not who. The verbatim snippet is left out (noisy, and closest to personal
 * data); the paraphrase carries the same meaning.
 */
export function insightEmbeddingText(issue: EmbeddableIssue): string {
  return [
    issue.area ? `Area: ${issue.area}` : null,
    `Action: ${issue.action_type}`,
    issue.summary,
    issue.root_cause ? `Root cause: ${issue.root_cause}` : null,
    issue.detail,
    issue.paraphrase ? `Customer: ${issue.paraphrase}` : null,
  ]
    .filter((line): line is string => !!line && line.trim().length > 0)
    .join("\n");
}

export interface EmbeddingRunResult {
  organizationId: string;
  embedded: number;
  model: string;
  usage: { promptTokens: number; totalTokens: number } | null;
  durationMs: number;
  error: string | null;
}

export class InsightEmbeddingService {
  private readonly model = config.openai.models.embedding.model || "text-embedding-3-small";
  private readonly dimensions = parseInt(process.env.EMBEDDING_DIM || "1536");
  private backoffUntil = new Map<string, number>();

  /** Embed up to `limit` enriched issues that have no embedding yet. */
  async embedPending(limit = 50): Promise<EmbeddingRunResult[]> {
    const now = Date.now();
    const paused = [...this.backoffUntil.entries()]
      .filter(([, until]) => until > now)
      .map(([orgId]) => orgId);

    const issues: EmbeddableIssue[] = await AppDataSource.query(
      `SELECT i.id, i.organization_id, i.action_type, i.area, i.summary, i.root_cause,
              i.paraphrase, i.detail
       FROM insight_issues i
       WHERE i.enriched_at IS NOT NULL
         AND NOT (i.organization_id = ANY($2::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM insight_issue_embeddings e WHERE e.insight_issue_id = i.id)
       ORDER BY i.created_at ASC
       LIMIT $1`,
      [limit, paused],
    );
    if (issues.length === 0) return [];

    const byOrg = new Map<string, EmbeddableIssue[]>();
    for (const issue of issues) {
      const list = byOrg.get(issue.organization_id) ?? [];
      list.push(issue);
      byOrg.set(issue.organization_id, list);
    }

    const results: EmbeddingRunResult[] = [];
    for (const [organizationId, orgIssues] of byOrg) {
      results.push(await this.embedForOrganization(organizationId, orgIssues));
    }
    return results;
  }

  private async embedForOrganization(
    organizationId: string,
    issues: EmbeddableIssue[],
  ): Promise<EmbeddingRunResult> {
    const startedAt = Date.now();
    const texts = issues.map(insightEmbeddingText);
    try {
      const { embedding: provider, region } =
        await llmProviderFactory.forOrganization(organizationId);
      const result = await provider.embed({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      });
      if (result.dimensions !== this.dimensions || result.embeddings.length !== issues.length) {
        throw new Error(
          `Embedding mismatch: got ${result.embeddings.length} x ${result.dimensions}, expected ${issues.length} x ${this.dimensions}`,
        );
      }
      emitUsage({
        kind: "embedding",
        usage: result.usage,
        model: result.model,
        provider: result.provider,
        organizationId,
        region,
      });

      const values: unknown[] = [];
      const rows = issues.map((issue, i) => {
        const base = i * 5;
        values.push(
          organizationId,
          issue.id,
          texts[i],
          result.model.slice(0, 128),
          `[${result.embeddings[i].join(",")}]`,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`;
      });
      await AppDataSource.query(
        `INSERT INTO insight_issue_embeddings
           (organization_id, insight_issue_id, content, model, embedding)
         VALUES ${rows.join(", ")}
         ON CONFLICT (insight_issue_id) DO NOTHING`,
        values,
      );
      this.backoffUntil.delete(organizationId);
      return {
        organizationId,
        embedded: issues.length,
        model: result.model,
        usage: { promptTokens: result.usage.promptTokens, totalTokens: result.usage.totalTokens },
        durationMs: Date.now() - startedAt,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.backoffUntil.set(organizationId, Date.now() + ORG_BACKOFF_MS);
      logger.warn(
        { err: error, organizationId, count: issues.length },
        "Insight embedding failed; pausing this organization",
      );
      return {
        organizationId,
        embedded: 0,
        model: this.model,
        usage: null,
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }
  }
}

export const insightEmbeddingService = new InsightEmbeddingService();

/**
 * Insights observability and cost (D3-11). Every Insights LLM run (close
 * classification, feedback enrichment, an embedding batch) writes one
 * `insight_runs` row: model, tokens, estimated cost, duration, success.
 * Tracked only; nothing is capped. `getMetrics` feeds `insights.metrics`.
 */
import { AppDataSource } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { estimateCostUsd, type TokenUsage } from "./llm-pricing";

const logger = createLogger("insight-runs");

export const INSIGHT_RUN_KINDS = [
  "close_classification",
  "feedback_enrichment",
  "embedding",
  "cluster_naming",
  "docs_audit",
  "backfill_review",
] as const;
export type InsightRunKind = (typeof INSIGHT_RUN_KINDS)[number];

export interface InsightRunInput {
  organizationId: string;
  kind: InsightRunKind;
  model: string | null;
  usage: TokenUsage | null;
  durationMs: number;
  succeeded: boolean;
  /** Issues handled by the run (an embedding batch covers several). */
  items?: number;
}

export interface InsightMetrics {
  days: number;
  issuesPerDay: Array<{ day: string; source: string; count: number }>;
  pendingEnrichment: number;
  jobs: Array<{
    kind: InsightRunKind;
    runs: number;
    failures: number;
    items: number;
    avgDurationMs: number;
    p95DurationMs: number;
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    unpricedRuns: number;
  }>;
  totalEstimatedCostUsd: number;
}

export class InsightRunsService {
  /** Write one ledger row. Never throws: observability must not break the job. */
  async record(run: InsightRunInput): Promise<void> {
    try {
      await AppDataSource.query(
        `INSERT INTO insight_runs
           (organization_id, kind, model, items, prompt_tokens, cached_prompt_tokens,
            completion_tokens, estimated_cost_usd, duration_ms, succeeded)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          run.organizationId,
          run.kind,
          run.model ? run.model.slice(0, 128) : null,
          run.items ?? 1,
          run.usage?.promptTokens ?? 0,
          run.usage?.cachedPromptTokens ?? 0,
          run.usage?.completionTokens ?? 0,
          run.succeeded ? estimateCostUsd(run.model, run.usage) : null,
          Math.max(0, Math.round(run.durationMs)),
          run.succeeded,
        ],
      );
    } catch (error) {
      logger.warn(
        { err: error, organizationId: run.organizationId, kind: run.kind },
        "Could not record insight run",
      );
    }
  }

  /** Issues per day by source, job durations and estimated LLM cost for the last `days` days. */
  async getMetrics(organizationId: string, days = 30): Promise<InsightMetrics> {
    const since = `${days} days`;
    const [issueRows, pendingRows, jobRows] = await Promise.all([
      AppDataSource.query(
        `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
                source, count(*)::int AS count
         FROM insight_issues
         WHERE organization_id = $1 AND created_at >= now() - $2::interval
         GROUP BY 1, 2 ORDER BY 1, 2`,
        [organizationId, since],
      ),
      AppDataSource.query(
        `SELECT count(*)::int AS count FROM insight_issues
         WHERE organization_id = $1 AND enriched_at IS NULL`,
        [organizationId],
      ),
      AppDataSource.query(
        `SELECT kind,
                count(*)::int AS runs,
                count(*) FILTER (WHERE NOT succeeded)::int AS failures,
                coalesce(sum(items), 0)::int AS items,
                coalesce(round(avg(duration_ms)), 0)::int AS avg_duration_ms,
                coalesce(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)), 0)::int
                  AS p95_duration_ms,
                coalesce(sum(prompt_tokens), 0)::bigint AS prompt_tokens,
                coalesce(sum(cached_prompt_tokens), 0)::bigint AS cached_prompt_tokens,
                coalesce(sum(completion_tokens), 0)::bigint AS completion_tokens,
                coalesce(sum(estimated_cost_usd), 0)::float AS estimated_cost_usd,
                count(*) FILTER (WHERE succeeded AND estimated_cost_usd IS NULL)::int AS unpriced_runs
         FROM insight_runs
         WHERE organization_id = $1 AND created_at >= now() - $2::interval
         GROUP BY kind ORDER BY kind`,
        [organizationId, since],
      ),
    ]);

    const jobs = (jobRows as Array<Record<string, string | number>>).map((r) => ({
      kind: r.kind as InsightRunKind,
      runs: Number(r.runs),
      failures: Number(r.failures),
      items: Number(r.items),
      avgDurationMs: Number(r.avg_duration_ms),
      p95DurationMs: Number(r.p95_duration_ms),
      promptTokens: Number(r.prompt_tokens),
      cachedPromptTokens: Number(r.cached_prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      estimatedCostUsd: Math.round(Number(r.estimated_cost_usd) * 1_000_000) / 1_000_000,
      unpricedRuns: Number(r.unpriced_runs),
    }));
    return {
      days,
      issuesPerDay: issueRows as InsightMetrics["issuesPerDay"],
      pendingEnrichment: Number(pendingRows[0]?.count ?? 0),
      jobs,
      totalEstimatedCostUsd:
        Math.round(jobs.reduce((sum, j) => sum + j.estimatedCostUsd, 0) * 1_000_000) / 1_000_000,
    };
  }
}

export const insightRunsService = new InsightRunsService();

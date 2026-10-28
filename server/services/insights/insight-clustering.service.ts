/**
 * Nightly incremental clustering of insight issues (D3-12) plus recurrence
 * detection (D3-16).
 *
 * Per organization, inside one transaction holding an advisory lock:
 * 1. Join or create. Every embedded issue of the window that is in no
 *    cluster yet (oldest first) joins the most similar open cluster with the
 *    same polarity when cosine >= joinThreshold (τ≈0.86); otherwise it starts
 *    a new cluster. A cluster's centroid is the mean of its member vectors,
 *    updated incrementally.
 * 2. Merge. Two clusters with the same signature (polarity + action type)
 *    whose centroids reach mergeThreshold (τ₂≈0.91) merge, the smaller into
 *    the larger. The signature guard keeps e.g. a positive "shipping" pattern
 *    out of a negative one even when the wording is close.
 * 3. Stats and gate. Size in the window, negatives, high severity, thumbs-down,
 *    conversations, hand-offs, relevance, impact. A cluster is promoted (shown
 *    to the owner) once it has minClusterSize members in the window and at
 *    least one signal: high severity, average relevance >= 55, negative ratio
 *    >= 0.6, or a thumbs-down. Positive clusters need the size only. Once
 *    promoted, a cluster stays promoted.
 * 4. Recurrence. An `addressed` cluster that gains enough new members after
 *    it was addressed goes back to `new` (audited, user NULL).
 *
 * Then, outside the transaction, promoted clusters without a title (or that
 * grew by half since they were named) get one easy-tier LLM call for a title,
 * summary and hypothesis, with a deterministic fallback.
 *
 * HDBSCAN has no natural home in Node; the incremental centroid approach fits
 * pgvector and an org-sized 30-day window held in memory.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { createLogger } from "@server/lib/logger";
import { LLMService } from "@server/services/core/llm.service";
import { PromptService } from "@server/services/prompt.service";
import { redactInsightText } from "@server/services/close-classification/close-classifier.service";
import { insightRunsService } from "./insight-runs.service";
import {
  defaultThresholds,
  getOrganizationThresholds,
  type InsightThresholds,
} from "./insight-settings";

const logger = createLogger("insight-clustering");

/** Clusters this old (no new member) are not candidates for new joins, except addressed ones. */
const CANDIDATE_LOOKBACK_DAYS = 90;
const MAX_SNIPPETS = 10;
const MAX_PARAPHRASES = 5;
const MAX_NAMING_MEMBERS = 15;

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

export function parseVector(value: string | number[]): number[] {
  if (Array.isArray(value)) return value;
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Mean of two weighted centroids (sizes are the weights). */
export function mergeCentroids(a: number[], sizeA: number, b: number[], sizeB: number): number[] {
  const total = sizeA + sizeB;
  if (total === 0) return a.slice();
  return a.map((v, i) => (v * sizeA + b[i] * sizeB) / total);
}

export function signatureOf(polarity: string, actionType: string): string {
  return `${polarity}:${actionType}`;
}

export interface WorkingCluster {
  id: string | null; // null until inserted
  key: string; // stable in-memory key
  polarity: string;
  actionType: string;
  area: string | null;
  centroid: number[];
  size: number;
  /** Merged into another working cluster (by key). */
  mergedInto: string | null;
}

export interface WorkingIssue {
  id: string;
  polarity: string;
  actionType: string;
  area: string | null;
  vector: number[];
}

export interface Assignment {
  issueId: string;
  clusterKey: string;
  similarity: number | null;
}

/**
 * Step 1: assign issues to clusters (mutates `clusters`, appends new ones).
 * Joins need the same polarity; the best match above `joinThreshold` wins.
 */
export function assignIssues(
  issues: WorkingIssue[],
  clusters: WorkingCluster[],
  joinThreshold: number,
  newKey: () => string,
): Assignment[] {
  const assignments: Assignment[] = [];
  for (const issue of issues) {
    let best: WorkingCluster | null = null;
    let bestSim = -1;
    for (const cluster of clusters) {
      if (cluster.mergedInto || cluster.polarity !== issue.polarity) continue;
      const sim = cosine(issue.vector, cluster.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = cluster;
      }
    }
    if (best && bestSim >= joinThreshold) {
      best.centroid = mergeCentroids(best.centroid, best.size, issue.vector, 1);
      best.size += 1;
      assignments.push({ issueId: issue.id, clusterKey: best.key, similarity: bestSim });
    } else {
      const cluster: WorkingCluster = {
        id: null,
        key: newKey(),
        polarity: issue.polarity,
        actionType: issue.actionType,
        area: issue.area,
        centroid: issue.vector.slice(),
        size: 1,
        mergedInto: null,
      };
      clusters.push(cluster);
      assignments.push({ issueId: issue.id, clusterKey: cluster.key, similarity: null });
    }
  }
  return assignments;
}

export interface Merge {
  fromKey: string;
  intoKey: string;
  similarity: number;
}

/**
 * Step 2: merge clusters with the same signature above `mergeThreshold`,
 * the smaller into the larger, until no pair qualifies (mutates `clusters`).
 */
export function mergeClusters(clusters: WorkingCluster[], mergeThreshold: number): Merge[] {
  const merges: Merge[] = [];
  let merged = true;
  while (merged) {
    merged = false;
    let bestPair: [WorkingCluster, WorkingCluster, number] | null = null;
    const live = clusters.filter((c) => !c.mergedInto);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (signatureOf(a.polarity, a.actionType) !== signatureOf(b.polarity, b.actionType)) {
          continue;
        }
        const sim = cosine(a.centroid, b.centroid);
        if (sim >= mergeThreshold && (!bestPair || sim > bestPair[2])) bestPair = [a, b, sim];
      }
    }
    if (bestPair) {
      const [a, b, sim] = bestPair;
      // Keep the larger; on a tie keep the one that already exists in the DB.
      const keepA = a.size > b.size || (a.size === b.size && (a.id !== null || b.id === null));
      const into = keepA ? a : b;
      const from = keepA ? b : a;
      into.centroid = mergeCentroids(into.centroid, into.size, from.centroid, from.size);
      into.size += from.size;
      from.mergedInto = into.key;
      merges.push({ fromKey: from.key, intoKey: into.key, similarity: sim });
      merged = true;
    }
  }
  return merges;
}

export interface ClusterStats {
  polarity: string;
  windowSize: number;
  negativeCount: number;
  highSeverityCount: number;
  feedbackNegativeCount: number;
  avgRelevance: number;
}

/** Step 3: the promotion gate (D3 §0.1, starting values). */
export function passesPromotionGate(stats: ClusterStats, minClusterSize: number): boolean {
  if (stats.windowSize < minClusterSize) return false;
  if (stats.polarity === "positive") return true;
  const negativeRatio = stats.windowSize > 0 ? stats.negativeCount / stats.windowSize : 0;
  return (
    stats.highSeverityCount > 0 ||
    stats.avgRelevance >= 55 ||
    negativeRatio >= 0.6 ||
    stats.feedbackNegativeCount > 0
  );
}

/** Sort key for the Insights page: volume weighted by relevance and severity. */
export function impactScore(stats: ClusterStats): number {
  if (stats.windowSize === 0) return 0;
  const highRatio = stats.highSeverityCount / stats.windowSize;
  const polarityWeight = stats.polarity === "negative" ? 1 : 0.5;
  const score =
    stats.windowSize * (stats.avgRelevance / 100) * (1 + highRatio) * polarityWeight +
    stats.feedbackNegativeCount;
  return Math.round(score * 100) / 100;
}

/** New members after `addressed` that reopen the cluster (D3-16). */
export function recurrenceThreshold(minClusterSize: number, origin: string): number {
  if (origin === "docs_audit") return 1; // the next audit still finds it
  return Math.max(2, Math.ceil(minClusterSize / 2));
}

// ─── Service ────────────────────────────────────────────────────────────────

export interface ClusteringResult {
  organizationId: string;
  assigned: number;
  created: number;
  merged: number;
  promoted: number;
  recurred: number;
  named: number;
  skipped?: "locked";
}

interface IssueRow {
  id: string;
  polarity: string;
  action_type: string;
  area: string | null;
  embedding: string;
}

interface ClusterRow {
  id: string;
  polarity: string;
  action_type: string;
  area: string | null;
  centroid: string;
  size: number;
}

export class InsightClusteringService {
  private llmService = new LLMService();

  /** Organizations with something to cluster or whose window stats move. */
  async organizationsToCluster(windowDays: number): Promise<string[]> {
    const rows: Array<{ organization_id: string }> = await AppDataSource.query(
      `SELECT DISTINCT i.organization_id
         FROM insight_issues i
         JOIN insight_issue_embeddings e ON e.insight_issue_id = i.id
        WHERE i.created_at >= now() - ($1 || ' days')::interval
          AND i.source <> 'docs_audit'
          AND NOT EXISTS (SELECT 1 FROM insight_cluster_members m WHERE m.insight_issue_id = i.id)
       UNION
       SELECT DISTINCT organization_id FROM insight_clusters
        WHERE merged_into_id IS NULL
          AND last_seen_at >= now() - ($1 || ' days')::interval - interval '2 days'`,
      [String(windowDays)],
    );
    return rows.map((r) => r.organization_id);
  }

  /** The nightly job: every organization with work, one at a time. */
  async runAll(): Promise<ClusteringResult[]> {
    const { windowDays } = defaultThresholds();
    const orgIds = await this.organizationsToCluster(windowDays);
    const results: ClusteringResult[] = [];
    for (const organizationId of orgIds) {
      try {
        results.push(await this.clusterOrganization(organizationId));
      } catch (error) {
        logger.error({ err: error, organizationId }, "Insight clustering failed for organization");
      }
    }
    return results;
  }

  async clusterOrganization(
    organizationId: string,
    options: { nameClusters?: boolean } = {},
  ): Promise<ClusteringResult> {
    const thresholds = await getOrganizationThresholds(organizationId);
    const result: ClusteringResult = {
      organizationId,
      assigned: 0,
      created: 0,
      merged: 0,
      promoted: 0,
      recurred: 0,
      named: 0,
    };

    const locked = await AppDataSource.transaction(async (manager) => {
      const [{ locked: gotLock }] = await manager.query(
        `SELECT pg_try_advisory_xact_lock(hashtext('insight-clustering:' || $1)) AS locked`,
        [organizationId],
      );
      if (!gotLock) return false;
      await this.clusterInTransaction(manager, organizationId, thresholds, result);
      return true;
    });
    if (!locked) return { ...result, skipped: "locked" };

    if (options.nameClusters !== false) {
      result.named = await this.nameClusters(organizationId);
    }
    logger.info(result, "Insight clustering finished");
    return result;
  }

  private async clusterInTransaction(
    manager: EntityManager,
    organizationId: string,
    thresholds: InsightThresholds,
    result: ClusteringResult,
  ): Promise<void> {
    const window = String(thresholds.windowDays);
    const issueRows: IssueRow[] = await manager.query(
      `SELECT i.id, i.polarity, i.action_type, i.area, e.embedding::text AS embedding
         FROM insight_issues i
         JOIN insight_issue_embeddings e ON e.insight_issue_id = i.id
        WHERE i.organization_id = $1
          AND i.enriched_at IS NOT NULL
          AND i.source <> 'docs_audit'
          AND i.created_at >= now() - ($2 || ' days')::interval
          AND NOT EXISTS (SELECT 1 FROM insight_cluster_members m WHERE m.insight_issue_id = i.id)
        ORDER BY i.created_at ASC`,
      [organizationId, window],
    );
    const clusterRows: ClusterRow[] = await manager.query(
      `SELECT id, polarity, action_type, area, centroid::text AS centroid, size
         FROM insight_clusters
        WHERE organization_id = $1
          AND origin = 'clustering'
          AND merged_into_id IS NULL
          AND centroid IS NOT NULL
          AND (last_seen_at >= now() - ($2 || ' days')::interval OR state = 'addressed')`,
      [organizationId, String(CANDIDATE_LOOKBACK_DAYS)],
    );

    let keySeq = 0;
    const clusters: WorkingCluster[] = clusterRows.map((row) => ({
      id: row.id,
      key: row.id,
      polarity: row.polarity,
      actionType: row.action_type,
      area: row.area,
      centroid: parseVector(row.centroid),
      size: Number(row.size),
      mergedInto: null,
    }));
    const issues: WorkingIssue[] = issueRows.map((row) => ({
      id: row.id,
      polarity: row.polarity,
      actionType: row.action_type,
      area: row.area,
      vector: parseVector(row.embedding),
    }));

    const assignments = assignIssues(
      issues,
      clusters,
      thresholds.joinThreshold,
      () => `new-${keySeq++}`,
    );
    const merges = mergeClusters(clusters, thresholds.mergeThreshold);

    // Persist new clusters (including ones merged away in this run: insert the
    // survivor only, and point members at it).
    const resolveKey = (key: string): string => {
      let cluster = clusters.find((c) => c.key === key)!;
      while (cluster.mergedInto) cluster = clusters.find((c) => c.key === cluster.mergedInto)!;
      return cluster.key;
    };
    const touched = new Set<string>();
    for (const cluster of clusters) {
      if (cluster.id === null && !cluster.mergedInto) {
        const [row] = await manager.query(
          `INSERT INTO insight_clusters
             (organization_id, origin, polarity, action_type, area, signature, centroid)
           VALUES ($1, 'clustering', $2, $3, $4, $5, $6::vector)
           RETURNING id`,
          [
            organizationId,
            cluster.polarity,
            cluster.actionType,
            cluster.area?.slice(0, 64) ?? null,
            signatureOf(cluster.polarity, cluster.actionType),
            toVectorLiteral(cluster.centroid),
          ],
        );
        cluster.id = row.id;
        result.created++;
      }
    }
    const idOf = (key: string): string => clusters.find((c) => c.key === resolveKey(key))!.id!;

    for (const assignment of assignments) {
      const clusterId = idOf(assignment.clusterKey);
      await manager.query(
        `INSERT INTO insight_cluster_members (insight_issue_id, cluster_id, organization_id, similarity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (insight_issue_id) DO NOTHING`,
        [assignment.issueId, clusterId, organizationId, assignment.similarity],
      );
      touched.add(clusterId);
      result.assigned++;
    }

    for (const merge of merges) {
      const from = clusters.find((c) => c.key === merge.fromKey)!;
      const intoId = idOf(merge.intoKey);
      if (from.id === null) continue; // never persisted: its members already point at the survivor
      await manager.query(
        `UPDATE insight_cluster_members SET cluster_id = $1 WHERE cluster_id = $2`,
        [intoId, from.id],
      );
      const [fromRow]: Array<{ state: string }> = await manager.query(
        `SELECT state FROM insight_clusters WHERE id = $1`,
        [from.id],
      );
      await manager.query(
        `UPDATE insight_clusters SET merged_into_id = $1, updated_at = now() WHERE id = $2`,
        [intoId, from.id],
      );
      await manager.query(
        `INSERT INTO insight_state_audit (organization_id, cluster_id, from_state, to_state, reason)
         VALUES ($1, $2, $3, $3, $4)`,
        [organizationId, from.id, fromRow?.state ?? "new", `merged:${intoId}`],
      );
      touched.add(intoId);
      touched.delete(from.id);
      result.merged++;
    }

    // Centroids of surviving existing clusters that changed.
    for (const cluster of clusters) {
      if (!cluster.mergedInto && cluster.id && touched.has(cluster.id)) {
        await manager.query(`UPDATE insight_clusters SET centroid = $1::vector WHERE id = $2`, [
          toVectorLiteral(cluster.centroid),
          cluster.id,
        ]);
      }
    }

    // Stats for every cluster whose window numbers can have moved.
    const statRows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM insight_clusters
        WHERE organization_id = $1 AND merged_into_id IS NULL
          AND (id = ANY($2::uuid[])
               OR last_seen_at >= now() - ($3 || ' days')::interval - interval '2 days')`,
      [organizationId, [...touched], window],
    );
    for (const { id } of statRows) {
      const outcome = await this.refreshCluster(manager, id, thresholds);
      if (outcome.promoted) result.promoted++;
      if (outcome.recurred) result.recurred++;
    }
  }

  /**
   * Recompute a cluster's stats, evidence, gate and recurrence from its
   * members. Also used by the docs audit input for its own clusters.
   */
  async refreshCluster(
    manager: EntityManager,
    clusterId: string,
    thresholds: InsightThresholds,
  ): Promise<{ promoted: boolean; recurred: boolean }> {
    const window = String(thresholds.windowDays);
    const [stats] = await manager.query(
      `SELECT count(*)::int AS size,
              count(*) FILTER (WHERE i.created_at >= now() - ($2 || ' days')::interval)::int AS window_size,
              count(*) FILTER (WHERE i.polarity = 'negative'
                               AND i.created_at >= now() - ($2 || ' days')::interval)::int AS negative_count,
              count(*) FILTER (WHERE i.severity = 'high'
                               AND i.created_at >= now() - ($2 || ' days')::interval)::int AS high_severity_count,
              count(*) FILTER (WHERE i.source = 'user_feedback' AND i.signals->>'rating' = 'bad'
                               AND i.created_at >= now() - ($2 || ' days')::interval)::int AS feedback_negative_count,
              count(DISTINCT i.conversation_id)::int AS conversation_count,
              count(DISTINCT i.conversation_id) FILTER (WHERE i.signals->>'handedOff' = 'true')::int
                AS handed_off_count,
              coalesce(avg(i.relevance) FILTER (WHERE i.created_at >= now() - ($2 || ' days')::interval), 0)::float
                AS avg_relevance,
              min(i.created_at) AS first_seen_at,
              max(i.created_at) AS last_seen_at,
              mode() WITHIN GROUP (ORDER BY i.polarity) AS polarity,
              mode() WITHIN GROUP (ORDER BY i.action_type) AS action_type,
              mode() WITHIN GROUP (ORDER BY i.area) AS area
         FROM insight_cluster_members m
         JOIN insight_issues i ON i.id = m.insight_issue_id
        WHERE m.cluster_id = $1`,
      [clusterId, window],
    );
    const [cluster] = await manager.query(
      `SELECT id, organization_id, origin, state, promoted_at, addressed_at FROM insight_clusters WHERE id = $1`,
      [clusterId],
    );
    if (!cluster || Number(stats.size) === 0) return { promoted: false, recurred: false };

    const evidence: Array<{
      id: string;
      conversation_id: string | null;
      source: string;
      snippet: string | null;
      paraphrase: string | null;
    }> = await manager.query(
      `SELECT i.id, i.conversation_id, i.source, i.snippet, i.paraphrase
         FROM insight_cluster_members m
         JOIN insight_issues i ON i.id = m.insight_issue_id
        WHERE m.cluster_id = $1
        ORDER BY i.relevance DESC, i.created_at DESC
        LIMIT 60`,
      [clusterId],
    );
    const seenSnippets = new Set<string>();
    const snippets: Array<{
      issueId: string;
      conversationId: string | null;
      source: string;
      text: string;
    }> = [];
    const seenParaphrases = new Set<string>();
    const paraphrases: string[] = [];
    for (const row of evidence) {
      const snippet = row.snippet?.trim();
      if (snippet && snippets.length < MAX_SNIPPETS && !seenSnippets.has(snippet.toLowerCase())) {
        seenSnippets.add(snippet.toLowerCase());
        snippets.push({
          issueId: row.id,
          conversationId: row.conversation_id,
          source: row.source,
          text: snippet.slice(0, 300),
        });
      }
      const paraphrase = row.paraphrase?.trim();
      if (
        paraphrase &&
        paraphrases.length < MAX_PARAPHRASES &&
        !seenParaphrases.has(paraphrase.toLowerCase())
      ) {
        seenParaphrases.add(paraphrase.toLowerCase());
        paraphrases.push(paraphrase.slice(0, 500));
      }
    }

    const clusterStats: ClusterStats = {
      polarity: stats.polarity,
      windowSize: Number(stats.window_size),
      negativeCount: Number(stats.negative_count),
      highSeverityCount: Number(stats.high_severity_count),
      feedbackNegativeCount: Number(stats.feedback_negative_count),
      avgRelevance: Number(stats.avg_relevance),
    };
    const promote =
      !cluster.promoted_at &&
      (cluster.origin === "docs_audit" ||
        passesPromotionGate(clusterStats, thresholds.minClusterSize));

    // Recurrence: enough members after `addressed` reopen the cluster.
    let recurred = false;
    if (cluster.state === "addressed" && cluster.addressed_at) {
      const [{ after }] = await manager.query(
        `SELECT count(*)::int AS after
           FROM insight_cluster_members m
           JOIN insight_issues i ON i.id = m.insight_issue_id
          WHERE m.cluster_id = $1 AND i.created_at > $2`,
        [clusterId, cluster.addressed_at],
      );
      if (Number(after) >= recurrenceThreshold(thresholds.minClusterSize, cluster.origin)) {
        recurred = true;
      }
    }

    await manager.query(
      `UPDATE insight_clusters SET
         size = $2, window_size = $3, negative_count = $4, high_severity_count = $5,
         feedback_negative_count = $6, conversation_count = $7, handed_off_count = $8,
         avg_relevance = $9, impact_score = $10, first_seen_at = $11, last_seen_at = $12,
         polarity = $13, action_type = $14, area = $15, signature = $16,
         snippets = $17::jsonb, paraphrases = $18::jsonb,
         promoted_at = CASE WHEN $19 THEN now() ELSE promoted_at END,
         state = CASE WHEN $20 THEN 'new' ELSE state END,
         state_changed_at = CASE WHEN $20 THEN now() ELSE state_changed_at END,
         recurred_at = CASE WHEN $20 THEN now() ELSE recurred_at END,
         recurrence_count = recurrence_count + CASE WHEN $20 THEN 1 ELSE 0 END,
         updated_at = now()
       WHERE id = $1`,
      [
        clusterId,
        Number(stats.size),
        clusterStats.windowSize,
        clusterStats.negativeCount,
        clusterStats.highSeverityCount,
        clusterStats.feedbackNegativeCount,
        Number(stats.conversation_count),
        Number(stats.handed_off_count),
        Math.round(clusterStats.avgRelevance * 10) / 10,
        impactScore(clusterStats),
        stats.first_seen_at,
        stats.last_seen_at,
        stats.polarity,
        stats.action_type,
        stats.area ? String(stats.area).slice(0, 64) : null,
        signatureOf(stats.polarity, stats.action_type),
        JSON.stringify(snippets),
        JSON.stringify(paraphrases),
        promote,
        recurred,
      ],
    );
    if (recurred) {
      await manager.query(
        `INSERT INTO insight_state_audit (organization_id, cluster_id, from_state, to_state, reason)
         VALUES ($1, $2, 'addressed', 'new', 'recurred')`,
        [cluster.organization_id, clusterId],
      );
    }
    return { promoted: promote, recurred };
  }

  /** Title, summary and hypothesis for promoted clusters that need one. */
  async nameClusters(organizationId: string): Promise<number> {
    const rows: Array<{ id: string }> = await AppDataSource.query(
      `SELECT id FROM insight_clusters
        WHERE organization_id = $1 AND origin = 'clustering' AND merged_into_id IS NULL
          AND promoted_at IS NOT NULL
          AND (named_at IS NULL OR size >= ceil(named_size * 1.5))
        ORDER BY impact_score DESC
        LIMIT 20`,
      [organizationId],
    );
    let named = 0;
    for (const { id } of rows) {
      if (await this.nameCluster(organizationId, id)) named++;
    }
    return named;
  }

  async nameCluster(organizationId: string, clusterId: string): Promise<boolean> {
    const members: Array<{
      summary: string;
      root_cause: string | null;
      detail: string | null;
      paraphrase: string | null;
      area: string | null;
    }> = await AppDataSource.query(
      `SELECT i.summary, i.root_cause, i.detail, i.paraphrase, i.area
         FROM insight_cluster_members m
         JOIN insight_issues i ON i.id = m.insight_issue_id
        WHERE m.cluster_id = $1
        ORDER BY m.similarity DESC NULLS FIRST, i.relevance DESC
        LIMIT $2`,
      [clusterId, MAX_NAMING_MEMBERS],
    );
    const [cluster] = await AppDataSource.query(
      `SELECT polarity, action_type, area, size FROM insight_clusters WHERE id = $1`,
      [clusterId],
    );
    if (!cluster || members.length === 0) return false;

    const fallback = {
      title: members[0].summary.slice(0, 120) || members[0].area || cluster.action_type,
      summary: members[0].summary,
      hypothesis: members.find((m) => m.root_cause)?.root_cause ?? null,
    };

    const startedAt = Date.now();
    let named = fallback;
    try {
      const prompt = await PromptService.getInstance().getPrompt(
        "insights/cluster-summary",
        {
          polarity: cluster.polarity,
          actionType: cluster.action_type,
          area: cluster.area ?? "",
          count: String(cluster.size),
          issues: members
            .map((m, i) =>
              [
                `${i + 1}. ${m.summary}`,
                m.root_cause ? `   Root cause: ${m.root_cause}` : null,
                m.detail ? `   Detail: ${m.detail}` : null,
                m.paraphrase ? `   Customer: ${m.paraphrase}` : null,
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n"),
        },
        { organizationId },
      );
      const response = await this.llmService.invokeWithMeta<string>({
        prompt,
        jsonSchema: CLUSTER_SUMMARY_JSON_SCHEMA,
        tier: "easy",
        temperature: 0,
        max_tokens: 600,
        organizationId,
      });
      const parsed = JSON.parse(response.content) as Record<string, unknown>;
      named = {
        title: redactInsightText(parsed.title, 120) ?? fallback.title,
        summary: redactInsightText(parsed.summary, 1000) ?? fallback.summary,
        hypothesis: redactInsightText(parsed.hypothesis, 1000) ?? fallback.hypothesis,
      };
      await insightRunsService.record({
        organizationId,
        kind: "cluster_naming",
        model: response.model,
        usage: response.usage,
        durationMs: Date.now() - startedAt,
        succeeded: true,
      });
    } catch (error) {
      logger.warn(
        { err: error, organizationId, clusterId },
        "Cluster naming failed; using fallback",
      );
      await insightRunsService.record({
        organizationId,
        kind: "cluster_naming",
        model: null,
        usage: null,
        durationMs: Date.now() - startedAt,
        succeeded: false,
      });
    }

    await AppDataSource.query(
      `UPDATE insight_clusters
          SET title = $2, summary = $3, hypothesis = $4, named_at = now(), named_size = size,
              updated_at = now()
        WHERE id = $1`,
      [clusterId, named.title, named.summary, named.hypothesis],
    );
    return true;
  }
}

export const CLUSTER_SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    hypothesis: { type: "string" },
  },
  required: ["title", "summary", "hypothesis"],
  additionalProperties: false,
} as const;

export const insightClusteringService = new InsightClusteringService();

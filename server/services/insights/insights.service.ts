/**
 * The Insights page (D3-13): promoted clusters with filters, a detail view
 * with evidence, and the lifecycle with its audit trail.
 *
 * Lifecycle: new -> acknowledged -> in_progress -> addressed, plus rejected
 * and archived. Recurrence (the clustering job) moves addressed back to new.
 * Every change writes an insight_state_audit row.
 */
import { AppDataSource } from "@server/database/data-source";
import { INSIGHT_ACTION_TYPES, INSIGHT_POLARITIES } from "../close-classification/outcome-rules";
import { ARCHIVE_SUGGESTION_DAYS, FIXED_OBSERVATION_DAYS } from "./insight-settings";

export const INSIGHT_STATES = [
  "new",
  "acknowledged",
  "in_progress",
  "addressed",
  "rejected",
  "archived",
] as const;
export type InsightState = (typeof INSIGHT_STATES)[number];

/** States shown by default: the owner's to-do list. */
export const OPEN_STATES: InsightState[] = ["new", "acknowledged", "in_progress"];

const TRANSITIONS: Record<InsightState, InsightState[]> = {
  new: ["acknowledged", "in_progress", "addressed", "rejected", "archived"],
  acknowledged: ["new", "in_progress", "addressed", "rejected", "archived"],
  in_progress: ["acknowledged", "addressed", "rejected", "archived"],
  addressed: ["in_progress", "archived"],
  rejected: ["new", "archived"],
  archived: ["new"],
};

export function canTransition(from: InsightState, to: InsightState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InsightError extends Error {
  constructor(
    public code: "NOT_FOUND" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
  }
}

export interface InsightListFilters {
  polarity?: (typeof INSIGHT_POLARITIES)[number];
  /** "open" (default) = new, acknowledged, in_progress; "all" = every state. */
  state?: InsightState | "open" | "all";
  actionType?: (typeof INSIGHT_ACTION_TYPES)[number];
  /** Window in days: counts members (and requires activity) in it. */
  days: number;
  minSize?: number;
}

export interface InsightSnippet {
  issueId: string;
  conversationId: string | null;
  source: string;
  text: string;
}

/** "Fixed" compares the weekly rate after addressed with the 30 days before. */
const BEFORE_DAYS = 30;

export type FixedStatus = "watching" | "fixed" | "improved" | "not_fixed";

/**
 * D3-16: did addressing it work? Watching for the first two weeks; then fixed
 * when the weekly rate fell to a quarter or less of the rate before.
 */
export function fixedStatus(
  addressedAt: Date | null,
  before: number,
  after: number,
  now = new Date(),
): { status: FixedStatus; beforePerWeek: number; afterPerWeek: number } | null {
  if (!addressedAt) return null;
  const days = (now.getTime() - new Date(addressedAt).getTime()) / 86400000;
  const beforePerWeek = Math.round((before / (BEFORE_DAYS / 7)) * 10) / 10;
  const afterPerWeek = Math.round((after / Math.max(days / 7, 1 / 7)) * 10) / 10;
  if (days < FIXED_OBSERVATION_DAYS) return { status: "watching", beforePerWeek, afterPerWeek };
  let status: FixedStatus;
  if (after === 0 || afterPerWeek <= beforePerWeek * 0.25) status = "fixed";
  else if (afterPerWeek < beforePerWeek) status = "improved";
  else status = "not_fixed";
  return { status, beforePerWeek, afterPerWeek };
}

export function archiveSuggested(state: string, lastSeenAt: Date, now = new Date()): boolean {
  return (
    ["new", "acknowledged", "addressed"].includes(state) &&
    now.getTime() - new Date(lastSeenAt).getTime() > ARCHIVE_SUGGESTION_DAYS * 86400000
  );
}

const LIST_COLUMNS = `
  c.id, c.origin, c.title, c.summary, c.hypothesis, c.polarity, c.action_type, c.area,
  c.state, c.size, c.window_size, c.conversation_count, c.handed_off_count,
  c.negative_count, c.high_severity_count, c.feedback_negative_count, c.avg_relevance,
  c.impact_score, c.first_seen_at, c.last_seen_at, c.promoted_at, c.state_changed_at,
  c.addressed_at, c.recurred_at, c.recurrence_count, c.approved_action,
  (SELECT count(*)::int FROM insight_cluster_members bm
     JOIN insight_issues bi ON bi.id = bm.insight_issue_id
    WHERE bm.cluster_id = c.id AND c.addressed_at IS NOT NULL
      AND bi.created_at >= c.addressed_at - interval '${BEFORE_DAYS} days'
      AND bi.created_at < c.addressed_at) AS before_count,
  (SELECT count(*)::int FROM insight_cluster_members am
     JOIN insight_issues ai ON ai.id = am.insight_issue_id
    WHERE am.cluster_id = c.id AND c.addressed_at IS NOT NULL
      AND ai.created_at >= c.addressed_at) AS after_count`;

type ClusterRow = Record<string, unknown> & { id: string; state: InsightState };

function toItem(row: ClusterRow) {
  return {
    id: row.id,
    origin: row.origin as string,
    title: (row.title as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    hypothesis: (row.hypothesis as string | null) ?? null,
    polarity: row.polarity as string,
    actionType: row.action_type as string,
    area: (row.area as string | null) ?? null,
    state: row.state,
    size: Number(row.size),
    periodSize: Number(row.period_size ?? row.window_size),
    conversationCount: Number(row.conversation_count),
    handedOffCount: Number(row.handed_off_count),
    negativeCount: Number(row.negative_count),
    highSeverityCount: Number(row.high_severity_count),
    feedbackNegativeCount: Number(row.feedback_negative_count),
    avgRelevance: Number(row.avg_relevance),
    impactScore: Number(row.impact_score),
    firstSeenAt: row.first_seen_at as Date,
    lastSeenAt: row.last_seen_at as Date,
    stateChangedAt: (row.state_changed_at as Date | null) ?? null,
    addressedAt: (row.addressed_at as Date | null) ?? null,
    recurredAt: (row.recurred_at as Date | null) ?? null,
    recurrenceCount: Number(row.recurrence_count),
    approvedAction: (row.approved_action as Record<string, unknown> | null) ?? null,
    fixed: fixedStatus(
      (row.addressed_at as Date | null) ?? null,
      Number(row.before_count ?? 0),
      Number(row.after_count ?? 0),
    ),
    archiveSuggested: archiveSuggested(row.state, row.last_seen_at as Date),
  };
}

export type InsightListItem = ReturnType<typeof toItem>;

export interface InsightApproval {
  kind: "playbook_edit" | "knowledge" | "task";
  playbookId: string | null;
  /** Evidence brief for the suggest-edits reviewers (both cap feedback at 4000). */
  feedback: string;
}

const BRIEF_MAX = 3900;

/** A plain evidence brief: what the pattern is, the likely cause and redacted examples. */
export function buildBrief(row: Record<string, unknown>): string {
  const lines: string[] = [];
  if (row.title) lines.push(`Pattern: ${row.title}`);
  if (row.summary) lines.push(`Summary: ${row.summary}`);
  if (row.hypothesis) lines.push(`Likely cause / fix: ${row.hypothesis}`);
  lines.push(`Seen in ${Number(row.size) || 0} conversations.`);
  const paraphrases = (row.paraphrases as string[] | null) ?? [];
  if (paraphrases.length) {
    lines.push("", "How shoppers put it:", ...paraphrases.map((p) => `- ${p}`));
  }
  const snippets = (row.snippets as InsightSnippet[] | null) ?? [];
  if (snippets.length) {
    lines.push("", "Examples (personal data removed):", ...snippets.map((s) => `- ${s.text}`));
  }
  const brief = lines.join("\n");
  return brief.length > BRIEF_MAX ? `${brief.slice(0, BRIEF_MAX - 1)}…` : brief;
}

export class InsightsService {
  async list(organizationId: string, filters: InsightListFilters) {
    const params: unknown[] = [organizationId, String(filters.days)];
    const where = [
      "c.organization_id = $1",
      "c.merged_into_id IS NULL",
      "c.promoted_at IS NOT NULL",
      "c.last_seen_at >= now() - ($2 || ' days')::interval",
    ];
    const state = filters.state ?? "open";
    if (state === "open") {
      params.push(OPEN_STATES);
      where.push(`c.state = ANY($${params.length}::varchar[])`);
    } else if (state !== "all") {
      params.push(state);
      where.push(`c.state = $${params.length}`);
    }
    if (filters.polarity) {
      params.push(filters.polarity);
      where.push(`c.polarity = $${params.length}`);
    }
    if (filters.actionType) {
      params.push(filters.actionType);
      where.push(`c.action_type = $${params.length}`);
    }
    let having = "";
    if (filters.minSize && filters.minSize > 1) {
      params.push(filters.minSize);
      having = `WHERE period_size >= $${params.length}`;
    }

    const rows: ClusterRow[] = await AppDataSource.query(
      `SELECT * FROM (
         SELECT ${LIST_COLUMNS},
                (SELECT count(*)::int FROM insight_cluster_members m
                   JOIN insight_issues i ON i.id = m.insight_issue_id
                  WHERE m.cluster_id = c.id
                    AND i.created_at >= now() - ($2 || ' days')::interval) AS period_size
           FROM insight_clusters c
          WHERE ${where.join(" AND ")}
       ) t ${having}
       ORDER BY (t.polarity = 'negative') DESC, t.impact_score DESC, t.last_seen_at DESC
       LIMIT 200`,
      params,
    );
    const items = rows.map(toItem);

    const [counts] = await AppDataSource.query(
      `SELECT count(*) FILTER (WHERE state = ANY($2::varchar[]))::int AS open,
              count(*) FILTER (WHERE state = 'new')::int AS new,
              count(*) FILTER (WHERE state = ANY($2::varchar[]) AND polarity = 'positive')::int AS positive,
              count(*) FILTER (WHERE state = 'addressed')::int AS addressed
         FROM insight_clusters
        WHERE organization_id = $1 AND merged_into_id IS NULL AND promoted_at IS NOT NULL`,
      [organizationId, OPEN_STATES],
    );
    // Fixed rate: of the addressed insights past the watching period, how many stayed fixed.
    const addressedRows: ClusterRow[] = await AppDataSource.query(
      `SELECT ${LIST_COLUMNS} FROM insight_clusters c
        WHERE c.organization_id = $1 AND c.merged_into_id IS NULL AND c.addressed_at IS NOT NULL
          AND c.state <> 'rejected'
        ORDER BY c.addressed_at DESC LIMIT 500`,
      [organizationId],
    );
    const measured = addressedRows
      .map((r) => toItem(r).fixed)
      .filter((f) => f && f.status !== "watching");
    const fixed = measured.filter((f) => f?.status === "fixed").length;

    return {
      items,
      counts: {
        open: Number(counts.open),
        new: Number(counts.new),
        positive: Number(counts.positive),
        addressed: Number(counts.addressed),
        fixed,
        measured: measured.length,
      },
    };
  }

  private async findCluster(organizationId: string, clusterId: string): Promise<ClusterRow> {
    const [row]: ClusterRow[] = await AppDataSource.query(
      `SELECT ${LIST_COLUMNS}, c.snippets, c.paraphrases, c.merged_into_id
         FROM insight_clusters c
        WHERE c.id = $1 AND c.organization_id = $2 AND c.promoted_at IS NOT NULL`,
      [clusterId, organizationId],
    );
    if (!row) throw new InsightError("NOT_FOUND", "Insight not found");
    return row;
  }

  async get(organizationId: string, clusterId: string) {
    const row = await this.findCluster(organizationId, clusterId);

    const [audit, members, channels, sources, polarities] = await Promise.all([
      AppDataSource.query(
        `SELECT a.id, a.from_state, a.to_state, a.reason, a.created_at,
                u.first_name, u.last_name, u.email
           FROM insight_state_audit a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.cluster_id = $1
          ORDER BY a.created_at DESC
          LIMIT 50`,
        [clusterId],
      ),
      AppDataSource.query(
        `SELECT i.id, i.source, i.polarity, i.severity, i.summary, i.created_at,
                c.id AS conversation_id, c.title AS conversation_title
           FROM insight_cluster_members m
           JOIN insight_issues i ON i.id = m.insight_issue_id
           LEFT JOIN conversations c ON c.id = i.conversation_id
          WHERE m.cluster_id = $1
          ORDER BY i.created_at DESC
          LIMIT 20`,
        [clusterId],
      ),
      this.breakdown(clusterId, "coalesce(i.signals->>'channel', 'unknown')"),
      this.breakdown(clusterId, "i.source"),
      this.breakdown(clusterId, "i.polarity"),
    ]);

    // Evidence links only for conversations that still exist (retention may have deleted them).
    const snippets = (row.snippets as InsightSnippet[]) ?? [];
    const conversationIds = snippets.map((s) => s.conversationId).filter(Boolean) as string[];
    const existing: Array<{ id: string }> = conversationIds.length
      ? await AppDataSource.query(
          `SELECT id FROM conversations WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
          [organizationId, conversationIds],
        )
      : [];
    const existingIds = new Set(existing.map((r) => r.id));

    return {
      ...toItem(row),
      snippets: snippets.map((s) => ({
        ...s,
        conversationId:
          s.conversationId && existingIds.has(s.conversationId) ? s.conversationId : null,
      })),
      paraphrases: (row.paraphrases as string[]) ?? [],
      allowedTransitions: TRANSITIONS[row.state] ?? [],
      breakdown: { channels, sources, polarities },
      members: (
        members as Array<{
          id: string;
          source: string;
          polarity: string;
          severity: string;
          summary: string;
          created_at: Date;
          conversation_id: string | null;
          conversation_title: string | null;
        }>
      ).map((m) => ({
        id: m.id,
        source: m.source,
        polarity: m.polarity,
        severity: m.severity,
        summary: m.summary,
        createdAt: m.created_at,
        conversationId: m.conversation_id,
        conversationTitle: m.conversation_title,
      })),
      audit: (
        audit as Array<{
          id: string;
          from_state: string | null;
          to_state: string;
          reason: string | null;
          created_at: Date;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
        }>
      ).map((a) => ({
        id: a.id,
        fromState: a.from_state,
        toState: a.to_state,
        reason: a.reason,
        createdAt: a.created_at,
        user: a.email ? [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email : null,
      })),
    };
  }

  private async breakdown(clusterId: string, expression: string) {
    const rows: Array<{ key: string; count: number }> = await AppDataSource.query(
      `SELECT ${expression} AS key, count(*)::int AS count
         FROM insight_cluster_members m
         JOIN insight_issues i ON i.id = m.insight_issue_id
        WHERE m.cluster_id = $1
        GROUP BY 1 ORDER BY 2 DESC`,
      [clusterId],
    );
    return rows.map((r) => ({ key: r.key, count: Number(r.count) }));
  }

  /** Move a cluster to another lifecycle state and audit it. */
  async setState(params: {
    organizationId: string;
    clusterId: string;
    to: InsightState;
    userId: string | null;
    reason?: string | null;
    approvedAction?: Record<string, unknown> | null;
  }): Promise<{ state: InsightState }> {
    const { organizationId, clusterId, to, userId } = params;
    return AppDataSource.transaction(async (manager) => {
      const [row]: Array<{ state: InsightState }> = await manager.query(
        `SELECT state FROM insight_clusters
          WHERE id = $1 AND organization_id = $2 AND promoted_at IS NOT NULL
            AND merged_into_id IS NULL
          FOR UPDATE`,
        [clusterId, organizationId],
      );
      if (!row) throw new InsightError("NOT_FOUND", "Insight not found");
      if (row.state !== to && !canTransition(row.state, to)) {
        throw new InsightError("BAD_REQUEST", `Cannot move an insight from ${row.state} to ${to}`);
      }
      await manager.query(
        `UPDATE insight_clusters SET
           state = $2::varchar,
           state_changed_at = now(),
           addressed_at = CASE WHEN $2::varchar = 'addressed' THEN now() ELSE addressed_at END,
           approved_action = coalesce($3::jsonb, approved_action),
           updated_at = now()
         WHERE id = $1`,
        [clusterId, to, params.approvedAction ? JSON.stringify(params.approvedAction) : null],
      );
      await manager.query(
        `INSERT INTO insight_state_audit (organization_id, cluster_id, from_state, to_state, user_id, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          organizationId,
          clusterId,
          row.state,
          to,
          userId,
          params.reason?.trim() ? params.reason.trim().slice(0, 1000) : null,
        ],
      );
      return { state: to };
    });
  }

  /**
   * Approve an insight (D3-14). Never applies anything: it moves the insight to
   * in_progress and tells the dashboard which reviewer to open. Playbook edits open
   * the suggest-edits diff (saved as a draft; the owner publishes), knowledge fixes
   * open the knowledge proposal, everything else becomes a tracked task.
   */
  async approve(params: {
    organizationId: string;
    clusterId: string;
    userId: string | null;
  }): Promise<InsightApproval> {
    const { organizationId, clusterId, userId } = params;
    const row = await this.findCluster(organizationId, clusterId);
    if (!OPEN_STATES.includes(row.state)) {
      throw new InsightError("BAD_REQUEST", "Only open insights can be approved");
    }
    const actionType = row.action_type as string;

    let approval: InsightApproval;
    if (actionType === "playbook_edit") {
      const playbookId = await this.mainPlaybook(organizationId, clusterId);
      approval = playbookId
        ? { kind: "playbook_edit", playbookId, feedback: buildBrief(row) }
        : { kind: "task", playbookId: null, feedback: buildBrief(row) };
    } else if (actionType === "knowledge_edit" || actionType === "knowledge_add") {
      approval = { kind: "knowledge", playbookId: null, feedback: buildBrief(row) };
    } else {
      approval = { kind: "task", playbookId: null, feedback: buildBrief(row) };
    }

    await this.setState({
      organizationId,
      clusterId,
      to: "in_progress",
      userId,
      reason: `approved:${approval.kind}`,
      approvedAction: {
        kind: approval.kind,
        playbookId: approval.playbookId,
        approvedAt: new Date().toISOString(),
        approvedBy: userId,
      },
    });
    return approval;
  }

  /** Tuning numbers for the settings dialog (D3-18): how the thresholds behave on real data. */
  async tuning(organizationId: string, windowDays: number) {
    const [row] = await AppDataSource.query(
      `SELECT
         (SELECT count(*)::int FROM insight_issues i
           WHERE i.organization_id = $1 AND i.source <> 'docs_audit'
             AND i.created_at >= now() - ($2 || ' days')::interval) AS issues,
         count(*)::int AS clusters,
         count(*) FILTER (WHERE promoted_at IS NOT NULL)::int AS promoted,
         count(*) FILTER (WHERE size = 1)::int AS singletons
       FROM insight_clusters
      WHERE organization_id = $1 AND origin = 'clustering' AND merged_into_id IS NULL
        AND last_seen_at >= now() - ($2 || ' days')::interval`,
      [organizationId, String(windowDays)],
    );
    return {
      issues: Number(row.issues),
      clusters: Number(row.clusters),
      promoted: Number(row.promoted),
      singletons: Number(row.singletons),
    };
  }

  /** The playbook most members ran under, if it still exists in the org. */
  private async mainPlaybook(organizationId: string, clusterId: string): Promise<string | null> {
    const [row]: Array<{ id: string }> = await AppDataSource.query(
      `SELECT p.id
         FROM insight_cluster_members m
         JOIN insight_issues i ON i.id = m.insight_issue_id
         JOIN playbooks p ON p.id::text = i.signals->>'playbookId' AND p.organization_id = $2
        WHERE m.cluster_id = $1
        GROUP BY p.id
        ORDER BY count(*) DESC
        LIMIT 1`,
      [clusterId, organizationId],
    );
    return row?.id ?? null;
  }
}

export const insightsService = new InsightsService();

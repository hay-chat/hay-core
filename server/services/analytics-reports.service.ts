import { AppDataSource } from "@server/database/data-source";
import { csvCell } from "@server/lib/csv";
import {
  HANDOFF_REASON_NOT_RECORDED,
  handoffCategory,
  isHandoffReason,
  type HandoffCategory,
  type ReportedHandoffReason,
} from "@server/orchestrator/handoff-reason";
import {
  CONVERSATION_OUTCOMES,
  type ConversationOutcomeKind,
} from "@server/services/close-classification/outcome-rules";

/**
 * Analytics reports read `conversation_outcomes`: one row per close, by close
 * time, the same table the bill is counted from.
 *
 * - A close counts unless its outcome is `test` or `spam`.
 * - "AI resolved" is what bills: `ai_resolved`, not reversed by the shopper
 *   coming back within 72 h, not excluded by the merchant. So the AI
 *   resolution rate is billed resolutions over real closes.
 * - Ranges are start-inclusive and end-exclusive.
 */

export interface ReportRange {
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** The range of the same length that ends where `range` starts. */
export function previousRange(range: ReportRange): ReportRange {
  const length = range.end.getTime() - range.start.getTime();
  return { start: new Date(range.start.getTime() - length), end: range.start };
}

/** A share as a percentage, or null when there is nothing to divide by. */
export function percentage(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null;
}

const REAL_CLOSES = `
  o.organization_id = $1
  AND o.closed_at >= $2
  AND o.closed_at < $3
  AND o.outcome NOT IN ('test', 'spam')`;
const AI_RESOLVED = `(o.ai_resolved AND o.reversed_at IS NULL AND o.excluded_at IS NULL)`;
const DAY = `to_char(o.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
/** Rows a table report returns at most; the rest is the long tail. */
const TABLE_LIMIT = 100;
const LOW_SCORE_MAX = 2;
const LOW_SCORE_LIMIT = 50;

function rangeParams(organizationId: string, range: ReportRange): unknown[] {
  return [organizationId, range.start, range.end];
}

function toNumber(value: string | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

// ---------------------------------------------------------------------------
// Overview: AI resolution rate
// ---------------------------------------------------------------------------

type CountedOutcome = Exclude<ConversationOutcomeKind, "test" | "spam">;

export interface ResolutionSummary {
  closes: number;
  aiResolved: number;
  handedOff: number;
  /** Percentages; null when the period has no closes. */
  aiResolutionRate: number | null;
  handoffRate: number | null;
  /** Closes by stored outcome. A reversed or excluded close keeps its outcome here. */
  outcomes: Record<CountedOutcome, number>;
}

export interface ResolutionTrendPoint {
  date: string;
  closes: number;
  aiResolved: number;
  handedOff: number;
}

function emptyOutcomes(): Record<CountedOutcome, number> {
  return Object.fromEntries(
    CONVERSATION_OUTCOMES.filter((o) => o !== "test" && o !== "spam").map((o) => [o, 0]),
  ) as Record<CountedOutcome, number>;
}

async function getResolutionSummary(
  organizationId: string,
  range: ReportRange,
): Promise<ResolutionSummary> {
  const rows: Array<{ outcome: string; closes: string; ai_resolved: string; handed_off: string }> =
    await AppDataSource.query(
      `
      SELECT
        o.outcome,
        COUNT(*) AS closes,
        COUNT(*) FILTER (WHERE ${AI_RESOLVED}) AS ai_resolved,
        COUNT(*) FILTER (WHERE o.handed_off) AS handed_off
      FROM conversation_outcomes o
      WHERE ${REAL_CLOSES}
      GROUP BY o.outcome
      `,
      rangeParams(organizationId, range),
    );

  const outcomes = emptyOutcomes();
  let closes = 0;
  let aiResolved = 0;
  let handedOff = 0;
  for (const row of rows) {
    const count = toNumber(row.closes);
    closes += count;
    aiResolved += toNumber(row.ai_resolved);
    handedOff += toNumber(row.handed_off);
    if (row.outcome in outcomes) outcomes[row.outcome as CountedOutcome] += count;
  }
  return {
    closes,
    aiResolved,
    handedOff,
    aiResolutionRate: percentage(aiResolved, closes),
    handoffRate: percentage(handedOff, closes),
    outcomes,
  };
}

async function getResolutionTrend(
  organizationId: string,
  range: ReportRange,
): Promise<ResolutionTrendPoint[]> {
  const rows: Array<{ date: string; closes: string; ai_resolved: string; handed_off: string }> =
    await AppDataSource.query(
      `
      SELECT
        ${DAY} AS date,
        COUNT(*) AS closes,
        COUNT(*) FILTER (WHERE ${AI_RESOLVED}) AS ai_resolved,
        COUNT(*) FILTER (WHERE o.handed_off) AS handed_off
      FROM conversation_outcomes o
      WHERE ${REAL_CLOSES}
      GROUP BY 1
      ORDER BY 1
      `,
      rangeParams(organizationId, range),
    );
  return rows.map((row) => ({
    date: row.date,
    closes: toNumber(row.closes),
    aiResolved: toNumber(row.ai_resolved),
    handedOff: toNumber(row.handed_off),
  }));
}

// ---------------------------------------------------------------------------
// CSAT
// ---------------------------------------------------------------------------

/**
 * Webchat conversations closed in the range, once each (a reopened one counts
 * by its latest close): the conversations that were shown the rating prompt.
 * CSAT is one rating per conversation and only the web widget asks for it.
 */
const SURVEYED = `
  WITH surveyed AS (
    SELECT DISTINCT ON (o.conversation_id)
      c.id,
      c.title,
      c.csat_rating,
      c.csat_rated_at,
      o.handed_off
    FROM conversation_outcomes o
    JOIN conversations c ON c.id = o.conversation_id
    WHERE ${REAL_CLOSES}
      AND c.deleted_at IS NULL
      AND c.channel = 'web'
    ORDER BY o.conversation_id, o.closed_at DESC
  )`;

export interface CsatGroup {
  /** Conversations that could have been rated. */
  surveyed: number;
  rated: number;
  /** 1 to 5; null when nothing was rated. */
  average: number | null;
}

export interface CsatSummary extends CsatGroup {
  responseRate: number | null;
  /** Conversations the AI handled alone, and ones a person joined. */
  ai: CsatGroup;
  human: CsatGroup;
  /** Ratings by score, index 0 = one star. */
  distribution: [number, number, number, number, number];
}

export interface CsatTrendPoint {
  date: string;
  rated: number;
  average: number;
}

export interface CsatLowScore {
  conversationId: string;
  title: string | null;
  rating: number;
  ratedAt: Date | null;
  handedOff: boolean;
}

async function getCsatSummary(organizationId: string, range: ReportRange): Promise<CsatSummary> {
  const rows: Array<{
    handed_off: boolean;
    surveyed: string;
    rated: string;
    total: string | null;
    r1: string;
    r2: string;
    r3: string;
    r4: string;
    r5: string;
  }> = await AppDataSource.query(
    `
    ${SURVEYED}
    SELECT
      handed_off,
      COUNT(*) AS surveyed,
      COUNT(csat_rating) AS rated,
      SUM(csat_rating) AS total,
      COUNT(*) FILTER (WHERE csat_rating = 1) AS r1,
      COUNT(*) FILTER (WHERE csat_rating = 2) AS r2,
      COUNT(*) FILTER (WHERE csat_rating = 3) AS r3,
      COUNT(*) FILTER (WHERE csat_rating = 4) AS r4,
      COUNT(*) FILTER (WHERE csat_rating = 5) AS r5
    FROM surveyed
    GROUP BY handed_off
    `,
    rangeParams(organizationId, range),
  );

  const group = (matching: typeof rows): CsatGroup => {
    const surveyed = matching.reduce((sum, row) => sum + toNumber(row.surveyed), 0);
    const rated = matching.reduce((sum, row) => sum + toNumber(row.rated), 0);
    const total = matching.reduce((sum, row) => sum + toNumber(row.total), 0);
    return { surveyed, rated, average: rated > 0 ? total / rated : null };
  };
  const all = group(rows);
  const stars = (key: "r1" | "r2" | "r3" | "r4" | "r5") =>
    rows.reduce((sum, row) => sum + toNumber(row[key]), 0);

  return {
    ...all,
    responseRate: percentage(all.rated, all.surveyed),
    ai: group(rows.filter((row) => !row.handed_off)),
    human: group(rows.filter((row) => row.handed_off)),
    distribution: [stars("r1"), stars("r2"), stars("r3"), stars("r4"), stars("r5")],
  };
}

async function getCsatTrend(organizationId: string, range: ReportRange): Promise<CsatTrendPoint[]> {
  const rows: Array<{ date: string; rated: string; average: string }> = await AppDataSource.query(
    `
    ${SURVEYED}
    SELECT
      to_char(csat_rated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COUNT(*) AS rated,
      AVG(csat_rating) AS average
    FROM surveyed
    WHERE csat_rating IS NOT NULL AND csat_rated_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1
    `,
    rangeParams(organizationId, range),
  );
  return rows.map((row) => ({
    date: row.date,
    rated: toNumber(row.rated),
    average: toNumber(row.average),
  }));
}

/** Rated conversations, lowest score first; `maxRating` and `limit` narrow it to the low scores. */
async function listCsatRatings(
  organizationId: string,
  range: ReportRange,
  options: { maxRating: number; limit: number },
): Promise<CsatLowScore[]> {
  const rows: Array<{
    id: string;
    title: string | null;
    csat_rating: number;
    csat_rated_at: Date | null;
    handed_off: boolean;
  }> = await AppDataSource.query(
    `
    ${SURVEYED}
    SELECT id, title, csat_rating, csat_rated_at, handed_off
    FROM surveyed
    WHERE csat_rating <= $4
    ORDER BY csat_rating ASC, csat_rated_at DESC NULLS LAST
    LIMIT $5
    `,
    [...rangeParams(organizationId, range), options.maxRating, options.limit],
  );
  return rows.map((row) => ({
    conversationId: row.id,
    title: row.title,
    rating: Number(row.csat_rating),
    ratedAt: row.csat_rated_at,
    handedOff: row.handed_off,
  }));
}

// ---------------------------------------------------------------------------
// Hand-offs
// ---------------------------------------------------------------------------

export interface HandoffReasonRow {
  reason: ReportedHandoffReason;
  category: HandoffCategory;
  count: number;
  /** Share of the period's hand-offs. */
  share: number | null;
}

export interface HandoffSummary {
  closes: number;
  handedOff: number;
  handoffRate: number | null;
  categories: Record<HandoffCategory, number>;
}

export interface HandoffTrendPoint extends Record<HandoffCategory, number> {
  date: string;
}

interface HandoffCounts {
  closes: number;
  /** Hand-offs by day and reason. */
  cells: Array<{ date: string; reason: ReportedHandoffReason; count: number }>;
}

/**
 * The reason is `metadata.handoffReason`, written at the first hand-off.
 * Conversations handed off before it was stored have none: a planned one is
 * still known from `plannedHandoff`, the rest report as not recorded.
 */
async function getHandoffCounts(
  organizationId: string,
  range: ReportRange,
): Promise<HandoffCounts> {
  const rows: Array<{ date: string; reason: string | null; count: string }> =
    await AppDataSource.query(
      `
      SELECT
        ${DAY} AS date,
        CASE
          WHEN NOT o.handed_off THEN NULL
          ELSE COALESCE(
            c.metadata->>'handoffReason',
            CASE WHEN c.metadata->>'plannedHandoff' = 'true' THEN 'playbook' END,
            '${HANDOFF_REASON_NOT_RECORDED}'
          )
        END AS reason,
        COUNT(*) AS count
      FROM conversation_outcomes o
      LEFT JOIN conversations c ON c.id = o.conversation_id
      WHERE ${REAL_CLOSES}
      GROUP BY 1, 2
      ORDER BY 1
      `,
      rangeParams(organizationId, range),
    );

  let closes = 0;
  const cells: HandoffCounts["cells"] = [];
  for (const row of rows) {
    const count = toNumber(row.count);
    closes += count;
    if (row.reason === null) continue;
    cells.push({
      date: row.date,
      reason: isHandoffReason(row.reason) ? row.reason : HANDOFF_REASON_NOT_RECORDED,
      count,
    });
  }
  return { closes, cells };
}

function emptyCategories(): Record<HandoffCategory, number> {
  return { planned: 0, customer_asked: 0, fallback: 0, not_recorded: 0 };
}

export function summarizeHandoffs(counts: HandoffCounts): {
  summary: HandoffSummary;
  reasons: HandoffReasonRow[];
  trend: HandoffTrendPoint[];
} {
  const categories = emptyCategories();
  const byReason = new Map<ReportedHandoffReason, number>();
  const byDay = new Map<string, HandoffTrendPoint>();
  let handedOff = 0;

  for (const cell of counts.cells) {
    const category = handoffCategory(cell.reason);
    handedOff += cell.count;
    categories[category] += cell.count;
    byReason.set(cell.reason, (byReason.get(cell.reason) ?? 0) + cell.count);
    const day = byDay.get(cell.date) ?? { date: cell.date, ...emptyCategories() };
    day[category] += cell.count;
    byDay.set(cell.date, day);
  }

  const reasons = [...byReason.entries()]
    .map(([reason, count]) => ({
      reason,
      category: handoffCategory(reason),
      count,
      share: percentage(count, handedOff),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    summary: {
      closes: counts.closes,
      handedOff,
      handoffRate: percentage(handedOff, counts.closes),
      categories,
    },
    reasons,
    trend: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------------------------------------------------------------------
// Topics and playbooks: the same columns, grouped differently
// ---------------------------------------------------------------------------

export interface PerformanceRow {
  closes: number;
  aiResolved: number;
  handedOff: number;
  aiResolutionRate: number | null;
  handoffRate: number | null;
  csatRated: number;
  csatAverage: number | null;
}

interface PerformanceRaw {
  closes: string;
  ai_resolved: string;
  handed_off: string;
  csat_rated: string;
  csat_average: string | null;
}

const PERFORMANCE_COLUMNS = `
  COUNT(*) AS closes,
  COUNT(*) FILTER (WHERE ${AI_RESOLVED}) AS ai_resolved,
  COUNT(*) FILTER (WHERE o.handed_off) AS handed_off,
  COUNT(c.csat_rating) AS csat_rated,
  AVG(c.csat_rating) AS csat_average`;

function toPerformanceRow(row: PerformanceRaw): PerformanceRow {
  const closes = toNumber(row.closes);
  const aiResolved = toNumber(row.ai_resolved);
  const handedOff = toNumber(row.handed_off);
  return {
    closes,
    aiResolved,
    handedOff,
    aiResolutionRate: percentage(aiResolved, closes),
    handoffRate: percentage(handedOff, closes),
    csatRated: toNumber(row.csat_rated),
    csatAverage: toNullableNumber(row.csat_average),
  };
}

export interface TopicRow extends PerformanceRow {
  topic: string;
}

export interface TopicsReport {
  /** Closes in the period, and how many of them the close review gave a topic. */
  closes: number;
  labelled: number;
  topics: TopicRow[];
}

/**
 * Topics are the `area` the close review writes for each close ("shipping",
 * "refund"). Free text, so only case and spacing are folded together.
 *
 * TODO: map near-synonyms ("shipping" / "delivery") onto one topic.
 */
async function getTopics(organizationId: string, range: ReportRange): Promise<TopicsReport> {
  const params = rangeParams(organizationId, range);
  const topic = `lower(btrim(i.area))`;
  const rows: Array<PerformanceRaw & { topic: string }> = await AppDataSource.query(
    `
    SELECT ${topic} AS topic, ${PERFORMANCE_COLUMNS}
    FROM conversation_outcomes o
    JOIN insight_issues i ON i.conversation_outcome_id = o.id AND i.source = 'ai_review'
    LEFT JOIN conversations c ON c.id = o.conversation_id
    WHERE ${REAL_CLOSES}
      AND btrim(COALESCE(i.area, '')) <> ''
    GROUP BY 1
    ORDER BY COUNT(*) DESC, 1
    LIMIT ${TABLE_LIMIT}
    `,
    params,
  );
  const totals: Array<{ closes: string; labelled: string }> = await AppDataSource.query(
    `
    SELECT
      COUNT(*) AS closes,
      COUNT(*) FILTER (WHERE btrim(COALESCE(i.area, '')) <> '') AS labelled
    FROM conversation_outcomes o
    LEFT JOIN insight_issues i ON i.conversation_outcome_id = o.id AND i.source = 'ai_review'
    WHERE ${REAL_CLOSES}
    `,
    params,
  );
  return {
    closes: toNumber(totals[0]?.closes),
    labelled: toNumber(totals[0]?.labelled),
    topics: rows.map((row) => ({ topic: row.topic, ...toPerformanceRow(row) })),
  };
}

export interface PlaybookRow extends PerformanceRow {
  /** Null for closes no playbook handled. */
  playbookId: string | null;
  /** Null when the playbook was deleted. */
  title: string | null;
  status: string | null;
}

/**
 * Each close goes to the playbook the conversation was on when it ended
 * (`conversations.playbook_id`), so a conversation that moved between
 * playbooks counts for the last one.
 */
async function getPlaybooks(organizationId: string, range: ReportRange): Promise<PlaybookRow[]> {
  const rows: Array<
    PerformanceRaw & { playbook_id: string | null; title: string | null; status: string | null }
  > = await AppDataSource.query(
    `
    SELECT c.playbook_id, p.title, p.status, ${PERFORMANCE_COLUMNS}
    FROM conversation_outcomes o
    LEFT JOIN conversations c ON c.id = o.conversation_id
    LEFT JOIN playbooks p ON p.id = c.playbook_id AND p.organization_id = o.organization_id
    WHERE ${REAL_CLOSES}
    GROUP BY c.playbook_id, p.title, p.status
    ORDER BY COUNT(*) DESC, p.title
    LIMIT ${TABLE_LIMIT}
    `,
    rangeParams(organizationId, range),
  );
  return rows.map((row) => ({
    playbookId: row.playbook_id,
    title: row.title,
    status: row.status,
    ...toPerformanceRow(row),
  }));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const ANALYTICS_REPORTS = ["overview", "csat", "handoffs", "topics", "playbooks"] as const;
export type AnalyticsReport = (typeof ANALYTICS_REPORTS)[number];

const CSV_MAX_ROWS = 50_000;

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

function rounded(value: number | null, digits = 1): string {
  return value === null ? "" : value.toFixed(digits);
}

const PERFORMANCE_HEADER = [
  "closes",
  "ai_resolved",
  "ai_resolution_rate",
  "handed_off",
  "handoff_rate",
  "csat_rated",
  "csat_average",
];

function performanceCells(row: PerformanceRow): unknown[] {
  return [
    row.closes,
    row.aiResolved,
    rounded(row.aiResolutionRate),
    row.handedOff,
    rounded(row.handoffRate),
    row.csatRated,
    rounded(row.csatAverage, 2),
  ];
}

export class AnalyticsReportsService {
  async getOverview(organizationId: string, range: ReportRange) {
    const [current, previous, trend] = await Promise.all([
      getResolutionSummary(organizationId, range),
      getResolutionSummary(organizationId, previousRange(range)),
      getResolutionTrend(organizationId, range),
    ]);
    return { current, previous, trend };
  }

  async getCsat(organizationId: string, range: ReportRange) {
    const [current, previous, trend, lowScores] = await Promise.all([
      getCsatSummary(organizationId, range),
      getCsatSummary(organizationId, previousRange(range)),
      getCsatTrend(organizationId, range),
      listCsatRatings(organizationId, range, { maxRating: LOW_SCORE_MAX, limit: LOW_SCORE_LIMIT }),
    ]);
    return { current, previous, trend, lowScores };
  }

  async getHandoffs(organizationId: string, range: ReportRange) {
    const [current, previous] = await Promise.all([
      getHandoffCounts(organizationId, range),
      getHandoffCounts(organizationId, previousRange(range)),
    ]);
    const report = summarizeHandoffs(current);
    return {
      current: report.summary,
      previous: summarizeHandoffs(previous).summary,
      reasons: report.reasons,
      trend: report.trend,
    };
  }

  getTopics(organizationId: string, range: ReportRange): Promise<TopicsReport> {
    return getTopics(organizationId, range);
  }

  async getPlaybooks(organizationId: string, range: ReportRange) {
    return { playbooks: await getPlaybooks(organizationId, range) };
  }

  /** One report's table as CSV. */
  async exportCsv(
    organizationId: string,
    report: AnalyticsReport,
    range: ReportRange,
  ): Promise<string> {
    switch (report) {
      case "overview": {
        const trend = await getResolutionTrend(organizationId, range);
        return toCsv(
          ["date", "closes", "ai_resolved", "ai_resolution_rate", "handed_off", "handoff_rate"],
          trend.map((day) => [
            day.date,
            day.closes,
            day.aiResolved,
            rounded(percentage(day.aiResolved, day.closes)),
            day.handedOff,
            rounded(percentage(day.handedOff, day.closes)),
          ]),
        );
      }
      case "csat": {
        const ratings = await listCsatRatings(organizationId, range, {
          maxRating: 5,
          limit: CSV_MAX_ROWS,
        });
        return toCsv(
          ["conversation_id", "rating", "rated_at", "handled_by"],
          ratings.map((row) => [
            row.conversationId,
            row.rating,
            row.ratedAt,
            row.handedOff ? "human" : "ai",
          ]),
        );
      }
      case "handoffs": {
        const { reasons } = summarizeHandoffs(await getHandoffCounts(organizationId, range));
        return toCsv(
          ["reason", "category", "hand_offs", "share"],
          reasons.map((row) => [row.reason, row.category, row.count, rounded(row.share)]),
        );
      }
      case "topics": {
        const { topics } = await getTopics(organizationId, range);
        return toCsv(
          ["topic", ...PERFORMANCE_HEADER],
          topics.map((row) => [row.topic, ...performanceCells(row)]),
        );
      }
      case "playbooks": {
        const playbooks = await getPlaybooks(organizationId, range);
        return toCsv(
          ["playbook_id", "playbook", "status", ...PERFORMANCE_HEADER],
          playbooks.map((row) => [row.playbookId, row.title, row.status, ...performanceCells(row)]),
        );
      }
    }
  }
}

export const analyticsReportsService = new AnalyticsReportsService();

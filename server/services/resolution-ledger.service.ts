import { TRPCError } from "@trpc/server";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import {
  ConversationOutcome,
  type ResolutionExclusionStatus,
} from "@server/database/entities/conversation-outcome.entity";
import { AuditLog } from "@server/entities/audit-log.entity";
import { Organization } from "@server/entities/organization.entity";
import {
  CONVERSATION_OUTCOMES,
  type ConversationOutcomeKind,
} from "@server/services/close-classification/outcome-rules";

/**
 * Usage page and resolution ledger (D1-5, D1-6).
 *
 * Periods follow the organization's billing period, which the operator that
 * bills sends with `internal.organizations.setBillingPeriod` (the current
 * period's start and end). Earlier periods step back from it by the same
 * length. An organization without one (self-hosted, or before the operator's
 * first sync) uses UTC calendar months.
 */

/** Self-serve exclusions allowed per period, as a share of its billable resolutions. */
export const SELF_SERVE_EXCLUSION_SHARE = 0.05;

/** How many periods back an exclusion may still be made (0 = current only). */
const EXCLUDABLE_PAST_PERIODS = 1;

/** Periods the usage page lets the merchant pick, the current one included. */
export const USAGE_PERIODS_SHOWN = 12;

const CSV_MAX_ROWS = 50_000;

export type LedgerStatus = "billed" | "reversed" | "excluded" | "pending_review" | "denied";

/** The operator's current billing period, as stored on the organization. */
export interface BillingPeriodAnchor {
  start: Date;
  /** Exclusive. */
  end: Date;
}

export interface UsagePeriod {
  /** 0 = the current period, 1 = the one before, ... */
  index: number;
  start: Date;
  /** Exclusive. */
  end: Date;
  /** `billing`: the operator's billing period; `calendar`: UTC calendar month (no operator period). */
  source: "billing" | "calendar";
}
export interface UsageSummary {
  period: UsagePeriod;
  /** What the operator bills: billable, not reversed, not excluded. */
  billable: number;
  breakdown: {
    billed: number;
    /** Part of `billed`: exclusion requested over the allowance, waiting for Hay.chat. */
    pendingReview: number;
    reversed: number;
    excluded: number;
    notBilled: Record<Exclude<ConversationOutcomeKind, "confirmed" | "assumed">, number>;
  };
  exclusions: { used: number; allowance: number; open: boolean };
  /** Only what core already knows from the operator (access state). */
  agentPaused: { paused: boolean; reason: string | null };
}

export interface LedgerItem {
  id: string;
  conversationId: string | null;
  conversationTitle: string | null;
  closedAt: Date;
  outcome: ConversationOutcomeKind;
  closeReason: string | null;
  classificationReason: string | null;
  status: LedgerStatus;
  exclusionReason: string | null;
  exclusionRequestedAt: Date | null;
  exclusionRequestedBy: string | null;
}

export interface PendingExclusion {
  id: string;
  organizationId: string;
  organizationName: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  closedAt: Date;
  outcome: ConversationOutcomeKind;
  closeReason: string | null;
  classificationReason: string | null;
  exclusionReason: string | null;
  exclusionRequestedAt: Date | null;
  exclusionRequestedBy: string | null;
}

export interface ExclusionResult {
  status: ResolutionExclusionStatus;
  used: number;
  allowance: number;
}

/** `date` moved by whole months in UTC, the day clamped to the target month's last day. */
function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function wholeMonthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Period `index` back from the one containing `now`. With an operator period,
 * its length (1 month, 12 months, ...) is the step and its start the anchor, so
 * a stale anchor (renewal not synced yet) still rolls into the right period.
 * Boundaries are computed from the anchor start each time, not chained, so
 * day clamping (31 Jan -> 28 Feb) does not drift.
 * TODO: an anchor on the 29th-31st steps back to the clamped day (a period
 * starting 28 Feb shows 28 Jan before it, where Stripe used 31 Jan). Off by up
 * to three days on past periods only; send the cycle anchor too if it matters.
 */
export function billingPeriodFor(
  anchor: BillingPeriodAnchor | null,
  index = 0,
  now: Date = new Date(),
): UsagePeriod {
  if (!anchor) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index + 1, 1));
    return { index, start, end, source: "calendar" };
  }
  const step = Math.max(1, Math.round(wholeMonthsBetween(anchor.start, anchor.end)));
  const boundary = (k: number): Date =>
    k === 0 ? anchor.start : k === 1 ? anchor.end : addMonthsUtc(anchor.start, k * step);
  let k = Math.floor(wholeMonthsBetween(anchor.start, now) / step);
  while (boundary(k).getTime() > now.getTime()) k -= 1;
  while (boundary(k + 1).getTime() <= now.getTime()) k += 1;
  return { index, start: boundary(k - index), end: boundary(k - index + 1), source: "billing" };
}

/** The excludable period (current or up to EXCLUDABLE_PAST_PERIODS back) containing `date`, or null. */
function excludablePeriodOf(
  anchor: BillingPeriodAnchor | null,
  date: Date,
  now: Date,
): UsagePeriod | null {
  for (let index = 0; index <= EXCLUDABLE_PAST_PERIODS; index++) {
    const period = billingPeriodFor(anchor, index, now);
    if (date >= period.start && date < period.end) return period;
  }
  return null;
}

/** Start of the oldest period whose closes may still be corrected (excluded, marked spam). */
function correctableSince(anchor: BillingPeriodAnchor | null, now: Date): Date {
  return billingPeriodFor(anchor, EXCLUDABLE_PAST_PERIODS, now).start;
}

/** The organization's stored billing period, or null (calendar months). */
async function loadPeriodAnchor(
  manager: EntityManager,
  organizationId: string,
): Promise<BillingPeriodAnchor | null> {
  const org = await manager.getRepository(Organization).findOne({
    where: { id: organizationId },
    select: { id: true, billingPeriodStart: true, billingPeriodEnd: true },
  });
  return org?.billingPeriodStart && org.billingPeriodEnd
    ? { start: org.billingPeriodStart, end: org.billingPeriodEnd }
    : null;
}

/** Instant exclusions allowed: 5 % of the period, at least one once something bills. */
export function exclusionAllowance(billableInPeriod: number): number {
  if (billableInPeriod <= 0) return 0;
  return Math.max(1, Math.floor(billableInPeriod * SELF_SERVE_EXCLUSION_SHARE));
}

export function ledgerStatus(row: {
  reversed_at: Date | null;
  excluded_at: Date | null;
  exclusion_status: ResolutionExclusionStatus | null;
}): LedgerStatus {
  if (row.reversed_at) return "reversed";
  if (row.excluded_at) return "excluded";
  if (row.exclusion_status === "pending_review") return "pending_review";
  if (row.exclusion_status === "denied") return "denied";
  return "billed";
}

/** A CSV cell, quoted, with spreadsheet formulas neutralised. */
function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

interface PeriodCounts {
  /** Billable and not reversed, excluded ones included: the allowance base. */
  base: number;
  /** Self-serve exclusions; ones Hay.chat approved on review do not use the allowance. */
  excluded: number;
}

async function periodCounts(
  manager: EntityManager,
  organizationId: string,
  period: UsagePeriod,
): Promise<PeriodCounts> {
  const raw = await manager
    .getRepository(ConversationOutcome)
    .createQueryBuilder("o")
    .select("COUNT(*) FILTER (WHERE o.reversed_at IS NULL)", "base")
    .addSelect(
      "COUNT(*) FILTER (WHERE o.exclusion_status = 'excluded' AND o.exclusion_reviewed_at IS NULL)",
      "excluded",
    )
    .where("o.organization_id = :organizationId", { organizationId })
    .andWhere("o.billable = true")
    .andWhere("o.closed_at >= :start AND o.closed_at < :end", {
      start: period.start,
      end: period.end,
    })
    .getRawOne<{ base: string; excluded: string }>();
  return { base: Number(raw?.base ?? 0), excluded: Number(raw?.excluded ?? 0) };
}

export class ResolutionLedgerService {
  /** The periods the usage page offers, newest first. */
  async listPeriods(organizationId: string, now: Date = new Date()): Promise<UsagePeriod[]> {
    const anchor = await loadPeriodAnchor(AppDataSource.manager, organizationId);
    return Array.from({ length: USAGE_PERIODS_SHOWN }, (_, index) =>
      billingPeriodFor(anchor, index, now),
    );
  }

  async getUsage(organizationId: string, periodIndex = 0): Promise<UsageSummary> {
    const period = billingPeriodFor(
      await loadPeriodAnchor(AppDataSource.manager, organizationId),
      periodIndex,
    );
    const rows = await AppDataSource.getRepository(ConversationOutcome)
      .createQueryBuilder("o")
      .select("o.outcome", "outcome")
      .addSelect("o.billable", "billable")
      .addSelect("o.reversed_at IS NOT NULL", "reversed")
      .addSelect("o.excluded_at IS NOT NULL", "excluded")
      .addSelect("o.exclusion_status = 'pending_review'", "pending")
      .addSelect("o.exclusion_reviewed_at IS NOT NULL", "reviewed")
      .addSelect("COUNT(*)", "count")
      .where("o.organization_id = :organizationId", { organizationId })
      .andWhere("o.closed_at >= :start AND o.closed_at < :end", {
        start: period.start,
        end: period.end,
      })
      .groupBy("o.outcome")
      .addGroupBy("o.billable")
      .addGroupBy("reversed")
      .addGroupBy("excluded")
      .addGroupBy("pending")
      .addGroupBy("reviewed")
      .getRawMany<{
        outcome: ConversationOutcomeKind;
        billable: boolean;
        reversed: boolean;
        excluded: boolean;
        pending: boolean | null;
        reviewed: boolean;
        count: string;
      }>();

    const notBilled = Object.fromEntries(
      CONVERSATION_OUTCOMES.filter((o) => o !== "confirmed" && o !== "assumed").map((o) => [o, 0]),
    ) as UsageSummary["breakdown"]["notBilled"];
    const breakdown: UsageSummary["breakdown"] = {
      billed: 0,
      pendingReview: 0,
      reversed: 0,
      excluded: 0,
      notBilled,
    };
    for (const row of rows) {
      const count = Number(row.count);
      if (!row.billable) {
        if (row.outcome in notBilled) {
          notBilled[row.outcome as keyof typeof notBilled] += count;
        }
        continue;
      }
      if (row.reversed) {
        breakdown.reversed += count;
      } else if (row.excluded) {
        breakdown.excluded += count;
      } else {
        breakdown.billed += count;
        if (row.pending) breakdown.pendingReview += count;
      }
    }
    // Exclusions used count every self-serve excluded row, reversed later or
    // not, like the allowance check does.
    const exclusionsUsed = rows
      .filter((row) => row.billable && row.excluded && !row.reviewed)
      .reduce((sum, row) => sum + Number(row.count), 0);
    const base = breakdown.billed + breakdown.excluded;

    const org = await AppDataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: { id: true, agentPausedAt: true, agentPauseReason: true },
    });

    return {
      period,
      billable: breakdown.billed,
      breakdown,
      exclusions: {
        used: exclusionsUsed,
        allowance: exclusionAllowance(base),
        open: period.index <= EXCLUDABLE_PAST_PERIODS,
      },
      agentPaused: {
        paused: Boolean(org?.agentPausedAt),
        reason: org?.agentPauseReason ?? null,
      },
    };
  }

  /** Billable resolutions of the period, newest first. */
  async listLedger(
    organizationId: string,
    input: { period?: number; page: number; pageSize: number },
  ): Promise<{ items: LedgerItem[]; total: number; period: UsagePeriod }> {
    const period = billingPeriodFor(
      await loadPeriodAnchor(AppDataSource.manager, organizationId),
      input.period ?? 0,
    );
    const query = this.ledgerQuery(organizationId, period);
    const total = await query.clone().getCount();
    const raw = await query
      .orderBy("o.closed_at", "DESC")
      .addOrderBy("o.id", "DESC")
      .offset((input.page - 1) * input.pageSize)
      .limit(input.pageSize)
      .getRawMany<LedgerRaw>();
    return { items: raw.map(toLedgerItem), total, period };
  }

  /** The period's ledger as CSV, for the merchant's records. */
  async exportLedgerCsv(organizationId: string, periodIndex = 0): Promise<string> {
    const period = billingPeriodFor(
      await loadPeriodAnchor(AppDataSource.manager, organizationId),
      periodIndex,
    );
    const raw = await this.ledgerQuery(organizationId, period)
      .orderBy("o.closed_at", "ASC")
      .addOrderBy("o.id", "ASC")
      .limit(CSV_MAX_ROWS)
      .getRawMany<LedgerRaw>();
    const header = [
      "closed_at",
      "conversation_id",
      "outcome",
      "status",
      "close_reason",
      "classification_reason",
      "exclusion_reason",
      "exclusion_requested_by",
      "exclusion_requested_at",
    ];
    const lines = raw
      .map(toLedgerItem)
      .map((item) =>
        [
          item.closedAt.toISOString(),
          item.conversationId,
          item.outcome,
          item.status,
          item.closeReason,
          item.classificationReason,
          item.exclusionReason,
          item.exclusionRequestedBy,
          item.exclusionRequestedAt?.toISOString() ?? null,
        ]
          .map(csvCell)
          .join(","),
      );
    return [header.join(","), ...lines].join("\n");
  }

  /**
   * Exclude a billable resolution (D1-6). Within the period's self-serve
   * allowance it is excluded at once and leaves the billable count; beyond it
   * the request is recorded for Hay.chat to review and the row stays billed.
   * Serialised per organization so two requests cannot both take the last
   * slot. Every request is written to audit_logs in the same transaction.
   */
  async exclude(input: {
    organizationId: string;
    outcomeId: string;
    userId: string;
    reason: string;
    now?: Date;
  }): Promise<ExclusionResult> {
    const now = input.now ?? new Date();
    const reason = input.reason.trim();
    if (!reason) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A reason is required" });
    }

    return AppDataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `resolution-exclusion:${input.organizationId}`,
      ]);

      const row = await manager
        .getRepository(ConversationOutcome)
        .createQueryBuilder("o")
        .setLock("pessimistic_write")
        .where("o.id = :id AND o.organization_id = :organizationId", {
          id: input.outcomeId,
          organizationId: input.organizationId,
        })
        .getOne();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Resolution not found" });
      }
      if (!row.billable || row.reversed_at) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This resolution is not billed" });
      }
      if (row.exclusion_status) {
        throw new TRPCError({ code: "CONFLICT", message: "An exclusion was already requested" });
      }

      const rowPeriod = excludablePeriodOf(
        await loadPeriodAnchor(manager, input.organizationId),
        row.closed_at,
        now,
      );
      if (!rowPeriod) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Resolutions from this period can no longer be excluded here",
        });
      }

      const counts = await periodCounts(manager, input.organizationId, rowPeriod);
      const allowance = exclusionAllowance(counts.base);
      const instant = counts.excluded < allowance;
      const status: ResolutionExclusionStatus = instant ? "excluded" : "pending_review";

      await manager.getRepository(ConversationOutcome).update(
        { id: row.id },
        {
          exclusion_status: status,
          exclusion_reason: reason,
          exclusion_requested_by: input.userId,
          exclusion_requested_at: now,
          excluded_at: instant ? now : null,
        },
      );

      await manager.getRepository(AuditLog).save(
        AuditLog.createLog({
          userId: input.userId,
          organizationId: input.organizationId,
          action: instant
            ? "billing.resolution.exclude"
            : "billing.resolution.exclusion_review_requested",
          resource: "conversation_outcome",
          changes: { exclusion_status: { from: null, to: status } },
          metadata: {
            outcomeId: row.id,
            conversationId: row.conversation_id,
            closedAt: row.closed_at.toISOString(),
            periodStart: rowPeriod.start.toISOString(),
            periodEnd: rowPeriod.end.toISOString(),
            reason,
            used: counts.excluded + (instant ? 1 : 0),
            allowance,
          },
          status: "success",
        }),
      );

      return { status, used: counts.excluded + (instant ? 1 : 0), allowance };
    });
  }

  /**
   * Exclusion requests waiting for Hay.chat (Lane A3), oldest first, across
   * organizations unless one is given. For the operator's staff queue only.
   */
  async listPendingExclusions(input: {
    organizationId?: string;
    limit: number;
  }): Promise<PendingExclusion[]> {
    const query = AppDataSource.getRepository(ConversationOutcome)
      .createQueryBuilder("o")
      .leftJoin("organizations", "org", "org.id = o.organization_id")
      .leftJoin("conversations", "c", "c.id = o.conversation_id")
      .leftJoin("users", "u", "u.id = o.exclusion_requested_by")
      .select([
        "o.id AS id",
        "o.organization_id AS organization_id",
        "org.name AS organization_name",
        "o.conversation_id AS conversation_id",
        "c.title AS conversation_title",
        "o.closed_at AS closed_at",
        "o.outcome AS outcome",
        "o.close_reason AS close_reason",
        "o.classification_reason AS classification_reason",
        "o.exclusion_reason AS exclusion_reason",
        "o.exclusion_requested_at AS exclusion_requested_at",
        "u.email AS requested_by_email",
      ])
      .where("o.exclusion_status = 'pending_review'")
      .orderBy("o.exclusion_requested_at", "ASC")
      .addOrderBy("o.id", "ASC")
      .limit(input.limit);
    if (input.organizationId) {
      query.andWhere("o.organization_id = :organizationId", {
        organizationId: input.organizationId,
      });
    }
    const raw = await query.getRawMany<{
      id: string;
      organization_id: string;
      organization_name: string | null;
      conversation_id: string | null;
      conversation_title: string | null;
      closed_at: Date;
      outcome: ConversationOutcomeKind;
      close_reason: string | null;
      classification_reason: string | null;
      exclusion_reason: string | null;
      exclusion_requested_at: Date | null;
      requested_by_email: string | null;
    }>();
    return raw.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      closedAt: new Date(row.closed_at),
      outcome: row.outcome,
      closeReason: row.close_reason,
      classificationReason: row.classification_reason,
      exclusionReason: row.exclusion_reason,
      exclusionRequestedAt: row.exclusion_requested_at
        ? new Date(row.exclusion_requested_at)
        : null,
      exclusionRequestedBy: row.requested_by_email,
    }));
  }

  /**
   * Hay.chat staff decide on an exclusion over the allowance (Lane A3).
   * Approve: excluded, leaves the billable count (the operator credits it if
   * overage was already reported). Deny: stays billed and cannot be requested
   * again. Only a `pending_review` row can be decided, once; the decision is
   * kept on the row and written to audit_logs in the same transaction.
   */
  async reviewExclusion(input: {
    organizationId: string;
    outcomeId: string;
    decision: "approve" | "deny";
    /** The staff login, from the operator. */
    reviewer: string;
    note?: string;
    now?: Date;
  }): Promise<{ status: ResolutionExclusionStatus }> {
    const now = input.now ?? new Date();
    const note = input.note?.trim() || null;
    return AppDataSource.transaction(async (manager) => {
      const row = await manager
        .getRepository(ConversationOutcome)
        .createQueryBuilder("o")
        .setLock("pessimistic_write")
        .where("o.id = :id AND o.organization_id = :organizationId", {
          id: input.outcomeId,
          organizationId: input.organizationId,
        })
        .getOne();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Resolution not found" });
      }
      if (row.exclusion_status !== "pending_review") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This exclusion is not waiting for review",
        });
      }

      const approve = input.decision === "approve";
      const status: ResolutionExclusionStatus = approve ? "excluded" : "denied";
      await manager.getRepository(ConversationOutcome).update(
        { id: row.id },
        {
          exclusion_status: status,
          excluded_at: approve ? now : null,
          exclusion_reviewed_at: now,
          exclusion_reviewed_by: input.reviewer,
          exclusion_review_note: note,
        },
      );

      await manager.getRepository(AuditLog).save(
        AuditLog.createLog({
          organizationId: input.organizationId,
          action: approve
            ? "billing.resolution.exclusion_approved"
            : "billing.resolution.exclusion_denied",
          resource: "conversation_outcome",
          changes: { exclusion_status: { from: "pending_review", to: status } },
          metadata: {
            source: "operator",
            reviewer: input.reviewer,
            note,
            outcomeId: row.id,
            conversationId: row.conversation_id,
            closedAt: row.closed_at.toISOString(),
            requestedBy: row.exclusion_requested_by,
            reason: row.exclusion_reason,
          },
          status: "success",
        }),
      );

      return { status };
    });
  }

  /**
   * Staff marked a conversation as spam: its closes stop billing. Only closes
   * from periods that can still be excluded are rewritten; older periods have
   * been billed. A pending close is settled here too, so the classifier never
   * bills it afterwards. Audited in the same transaction.
   */
  async markConversationSpam(input: {
    organizationId: string;
    conversationId: string;
    userId: string;
    now?: Date;
  }): Promise<number> {
    const now = input.now ?? new Date();
    return AppDataSource.transaction(async (manager) => {
      const [rows]: [Array<{ id: string; outcome: string; billable: boolean }>, number] =
        await manager.query(
          `UPDATE conversation_outcomes o
           SET outcome = 'spam',
               billable = false,
               ai_resolved = false,
               classified_by = 'staff',
               classified_at = COALESCE(o.classified_at, $4),
               claimed_until = NULL,
               updated_at = now()
           FROM conversation_outcomes before
           WHERE before.id = o.id
             AND o.organization_id = $1
             AND o.conversation_id = $2
             AND o.outcome NOT IN ('spam', 'test')
             AND o.closed_at >= $3
           RETURNING o.id, before.outcome, before.billable`,
          [
            input.organizationId,
            input.conversationId,
            correctableSince(await loadPeriodAnchor(manager, input.organizationId), now),
            now,
          ],
        );
      await manager.getRepository(AuditLog).save(
        AuditLog.createLog({
          userId: input.userId,
          organizationId: input.organizationId,
          action: "conversation.spam.marked",
          resource: "conversation",
          changes: {
            outcomes: rows.map((row) => ({
              outcomeId: row.id,
              outcome: { from: row.outcome, to: "spam" },
              billable: { from: row.billable, to: false },
            })),
          },
          metadata: { conversationId: input.conversationId },
          status: "success",
        }),
      );
      return rows.length;
    });
  }

  /**
   * Staff said "Not spam": spam closes go back to the close classifier, which
   * decides their outcome afresh. That covers spam from the flag (the
   * detector, a staff mark) and spam the LLM found at close: the classifier
   * no longer accepts a spam verdict once staff cleared the conversation.
   * Same period limit as marking. Audited in the same transaction.
   */
  async clearConversationSpam(input: {
    organizationId: string;
    conversationId: string;
    userId: string;
    now?: Date;
  }): Promise<number> {
    const now = input.now ?? new Date();
    return AppDataSource.transaction(async (manager) => {
      const [rows]: [Array<{ id: string }>, number] = await manager.query(
        `UPDATE conversation_outcomes
         SET classified_at = NULL,
             classified_by = 'rule',
             attempts = 0,
             claimed_until = NULL,
             last_error = NULL,
             updated_at = now()
         WHERE organization_id = $1
           AND conversation_id = $2
           AND outcome = 'spam'
           AND classified_by IN ('rule', 'staff', 'llm')
           AND closed_at >= $3
         RETURNING id`,
        [
          input.organizationId,
          input.conversationId,
          correctableSince(await loadPeriodAnchor(manager, input.organizationId), now),
        ],
      );
      await manager.getRepository(AuditLog).save(
        AuditLog.createLog({
          userId: input.userId,
          organizationId: input.organizationId,
          action: "conversation.spam.cleared",
          resource: "conversation",
          changes: { reclassifyOutcomes: rows.map((row) => row.id) },
          metadata: { conversationId: input.conversationId },
          status: "success",
        }),
      );
      return rows.length;
    });
  }

  private ledgerQuery(organizationId: string, period: UsagePeriod) {
    return AppDataSource.getRepository(ConversationOutcome)
      .createQueryBuilder("o")
      .leftJoin("conversations", "c", "c.id = o.conversation_id")
      .leftJoin("users", "u", "u.id = o.exclusion_requested_by")
      .select([
        "o.id AS id",
        "o.conversation_id AS conversation_id",
        "c.title AS conversation_title",
        "o.closed_at AS closed_at",
        "o.outcome AS outcome",
        "o.close_reason AS close_reason",
        "o.classification_reason AS classification_reason",
        "o.reversed_at AS reversed_at",
        "o.excluded_at AS excluded_at",
        "o.exclusion_status AS exclusion_status",
        "o.exclusion_reason AS exclusion_reason",
        "o.exclusion_requested_at AS exclusion_requested_at",
        "u.email AS requested_by_email",
      ])
      .where("o.organization_id = :organizationId", { organizationId })
      .andWhere("o.billable = true")
      .andWhere("o.closed_at >= :start AND o.closed_at < :end", {
        start: period.start,
        end: period.end,
      });
  }
}

interface LedgerRaw {
  id: string;
  conversation_id: string | null;
  conversation_title: string | null;
  closed_at: Date;
  outcome: ConversationOutcomeKind;
  close_reason: string | null;
  classification_reason: string | null;
  reversed_at: Date | null;
  excluded_at: Date | null;
  exclusion_status: ResolutionExclusionStatus | null;
  exclusion_reason: string | null;
  exclusion_requested_at: Date | null;
  requested_by_email: string | null;
}

function toLedgerItem(raw: LedgerRaw): LedgerItem {
  return {
    id: raw.id,
    conversationId: raw.conversation_id,
    conversationTitle: raw.conversation_title,
    closedAt: new Date(raw.closed_at),
    outcome: raw.outcome,
    closeReason: raw.close_reason,
    classificationReason: raw.classification_reason,
    status: ledgerStatus(raw),
    exclusionReason: raw.exclusion_reason,
    exclusionRequestedAt: raw.exclusion_requested_at ? new Date(raw.exclusion_requested_at) : null,
    exclusionRequestedBy: raw.requested_by_email,
  };
}

export const resolutionLedgerService = new ResolutionLedgerService();

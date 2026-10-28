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
 * Core does not know the merchant's billing period (the operator that bills
 * reads `billableResolutions` for its own period dates), so the usage page and
 * the exclusion allowance work per UTC calendar month.
 * TODO: when core receives the operator's period dates (alongside the access
 * state), use them here instead of the calendar month.
 */

/** Self-serve exclusions allowed per period, as a share of its billable resolutions. */
export const SELF_SERVE_EXCLUSION_SHARE = 0.05;

/** How many periods back an exclusion may still be made (0 = current only). */
const EXCLUDABLE_PAST_PERIODS = 1;

const CSV_MAX_ROWS = 50_000;

export type LedgerStatus = "billed" | "reversed" | "excluded" | "pending_review";

export interface UsagePeriod {
  /** YYYY-MM */
  month: string;
  start: Date;
  /** Exclusive. */
  end: Date;
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

export interface ExclusionResult {
  status: ResolutionExclusionStatus;
  used: number;
  allowance: number;
}

/** The UTC calendar month `month` (YYYY-MM), or the current one. */
export function periodFor(month?: string, now: Date = new Date()): UsagePeriod {
  let year = now.getUTCFullYear();
  let monthIndex = now.getUTCMonth();
  if (month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const parsedMonth = match ? Number(match[2]) - 1 : -1;
    if (!match || parsedMonth < 0 || parsedMonth > 11) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid month" });
    }
    year = Number(match[1]);
    monthIndex = parsedMonth;
  }
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { month: start.toISOString().slice(0, 7), start, end };
}

/** Months between two periods (b - a). */
function monthsBetween(a: UsagePeriod, b: UsagePeriod): number {
  return (
    (b.start.getUTCFullYear() - a.start.getUTCFullYear()) * 12 +
    (b.start.getUTCMonth() - a.start.getUTCMonth())
  );
}

/** Start of the oldest period whose closes may still be corrected (excluded, marked spam). */
function correctableSince(now: Date): Date {
  const current = periodFor(undefined, now).start;
  return new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - EXCLUDABLE_PAST_PERIODS, 1),
  );
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
    .addSelect("COUNT(*) FILTER (WHERE o.exclusion_status = 'excluded')", "excluded")
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
  async getUsage(organizationId: string, month?: string): Promise<UsageSummary> {
    const period = periodFor(month);
    const rows = await AppDataSource.getRepository(ConversationOutcome)
      .createQueryBuilder("o")
      .select("o.outcome", "outcome")
      .addSelect("o.billable", "billable")
      .addSelect("o.reversed_at IS NOT NULL", "reversed")
      .addSelect("o.excluded_at IS NOT NULL", "excluded")
      .addSelect("o.exclusion_status = 'pending_review'", "pending")
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
      .getRawMany<{
        outcome: ConversationOutcomeKind;
        billable: boolean;
        reversed: boolean;
        excluded: boolean;
        pending: boolean | null;
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
    // Exclusions used count every excluded row, reversed later or not, like
    // the allowance check does.
    const exclusionsUsed = rows
      .filter((row) => row.billable && row.excluded)
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
        open: this.isExcludable(period),
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
    input: { month?: string; page: number; pageSize: number },
  ): Promise<{ items: LedgerItem[]; total: number; period: UsagePeriod }> {
    const period = periodFor(input.month);
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
  async exportLedgerCsv(organizationId: string, month?: string): Promise<string> {
    const period = periodFor(month);
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

      const rowPeriod = periodFor(row.closed_at.toISOString().slice(0, 7));
      if (!this.isExcludable(rowPeriod, now)) {
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
            period: rowPeriod.month,
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
          [input.organizationId, input.conversationId, correctableSince(now), now],
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
   * Staff said "Not spam": closes that were spam only because of the flag
   * (the rule, or a staff mark) go back to the close classifier, which
   * decides their outcome afresh. Spam the LLM itself found stays. Same
   * period limit as marking. Audited in the same transaction.
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
           AND classified_by IN ('rule', 'staff')
           AND closed_at >= $3
         RETURNING id`,
        [input.organizationId, input.conversationId, correctableSince(now)],
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

  private isExcludable(period: UsagePeriod, now: Date = new Date()): boolean {
    const back = monthsBetween(period, periodFor(undefined, now));
    return back >= 0 && back <= EXCLUDABLE_PAST_PERIODS;
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

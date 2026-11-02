/**
 * Soft-launch readiness (D7-13): how a team has been reviewing the assistant's
 * replies while Require Approval is on. Per week: replies approved as they
 * were, edited before sending, and blocked. When enough replies were reviewed
 * recently and few needed a change, the dashboard hints that it may be safe
 * to turn approval off.
 *
 * Require Approval holds the AI's replies only. Actions that change store
 * data go through the separate action approvals (D4), so nothing here speaks
 * for them.
 */

import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";

/** Look-back window for the hint. */
export const READINESS_WINDOW_DAYS = 14;
/** Fewer reviewed replies than this in the window is too small a sample. */
export const READINESS_MIN_REVIEWED = 50;
/** At most this share of reviewed replies edited or blocked (1 in 20). */
export const READINESS_MAX_CHANGED_SHARE = 0.05;

export interface ReadinessWeek {
  /** Monday of the week (UTC), ISO date. */
  weekStart: string;
  approved: number;
  edited: number;
  blocked: number;
}

export type ReadinessHint =
  /** Approval is off: nothing to decide. */
  "approval_off" | "not_enough_reviews" | "too_many_changes" | "ready";

export interface AssistantReadiness {
  requireApproval: boolean;
  weeks: ReadinessWeek[];
  window: {
    days: number;
    /** Reviewed replies needed in the window before the hint can say "ready". */
    minReviewed: number;
    reviewed: number;
    approved: number;
    edited: number;
    blocked: number;
    /** Replies still waiting for review right now. */
    waiting: number;
  };
  hint: ReadinessHint;
}

/** Pure: the hint from the window's counts. */
export function readinessHint(
  requireApproval: boolean,
  window: { reviewed: number; edited: number; blocked: number },
): ReadinessHint {
  if (!requireApproval) return "approval_off";
  if (window.reviewed < READINESS_MIN_REVIEWED) return "not_enough_reviews";
  const changed = window.edited + window.blocked;
  return changed <= window.reviewed * READINESS_MAX_CHANGED_SHARE ? "ready" : "too_many_changes";
}

/** Real conversations only: not the playground, not simulations, replays or tests. */
const REAL_CONVERSATION_SQL = `
  COALESCE(c.metadata->>'sourceId', '') <> 'playground'
  AND COALESCE(c.metadata->>'isPlayground', 'false') <> 'true'
  AND c.metadata->>'runKind' IS NULL`;

export class SoftLaunchReadinessService {
  async forOrganization(
    organizationId: string,
    options: { weeks?: number; now?: Date } = {},
  ): Promise<AssistantReadiness> {
    const weeks = options.weeks ?? 8;
    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    const windowStart = new Date(now.getTime() - READINESS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const organization = await AppDataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
    });

    // A reviewed reply has approved_at: approve, edit and block all set it.
    const weekly: Array<{
      week_start: string;
      approved: number;
      edited: number;
      blocked: number;
    }> = await AppDataSource.query(
      `SELECT to_char(date_trunc('week', m.approved_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week_start,
              COUNT(*) FILTER (WHERE m.status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE m.status = 'edited')::int AS edited,
              COUNT(*) FILTER (WHERE m.status = 'rejected')::int AS blocked
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = $1
          AND m.type = 'BotAgent'
          AND m.approved_at >= $2
          AND m.status IN ('approved', 'edited', 'rejected')
          AND ${REAL_CONVERSATION_SQL}
        GROUP BY 1
        ORDER BY 1`,
      [organizationId, since],
    );

    const [counts]: Array<{
      approved: number;
      edited: number;
      blocked: number;
      waiting: number;
    }> = await AppDataSource.query(
      `SELECT COUNT(*) FILTER (WHERE m.status = 'approved' AND m.approved_at >= $2)::int AS approved,
              COUNT(*) FILTER (WHERE m.status = 'edited' AND m.approved_at >= $2)::int AS edited,
              COUNT(*) FILTER (WHERE m.status = 'rejected' AND m.approved_at >= $2)::int AS blocked,
              COUNT(*) FILTER (WHERE m.status = 'pending' AND m.delivery_state = 'queued')::int AS waiting
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.organization_id = $1
          AND m.type = 'BotAgent'
          AND (m.approved_at >= $2 OR (m.status = 'pending' AND m.delivery_state = 'queued'))
          AND ${REAL_CONVERSATION_SQL}`,
      [organizationId, windowStart],
    );

    const requireApproval = organization?.settings?.testModeDefault === true;
    const window = {
      days: READINESS_WINDOW_DAYS,
      minReviewed: READINESS_MIN_REVIEWED,
      approved: counts?.approved ?? 0,
      edited: counts?.edited ?? 0,
      blocked: counts?.blocked ?? 0,
      waiting: counts?.waiting ?? 0,
      reviewed: (counts?.approved ?? 0) + (counts?.edited ?? 0) + (counts?.blocked ?? 0),
    };
    return {
      requireApproval,
      weeks: weekly.map((w) => ({
        weekStart: w.week_start,
        approved: w.approved,
        edited: w.edited,
        blocked: w.blocked,
      })),
      window,
      hint: readinessHint(requireApproval, window),
    };
  }
}

export const softLaunchReadinessService = new SoftLaunchReadinessService();

import { AppDataSource } from "@server/database/data-source";
import { BusinessHoursSchedule } from "@server/database/entities/business-hours-schedule.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { DEFAULT_TIMEZONE } from "@server/types/organization-settings.types";
import {
  isValidTimeZone,
  type Availability,
  type BusinessHoursClosure,
  type WeeklyInterval,
} from "@server/types/business-hours.types";

/**
 * Business hours and availability (D5-6).
 *
 * A schedule covers channels (or is the organization default); a channel with
 * no schedule is always within hours. Availability combines the schedule with
 * who is reachable: an Available, active member who is online now or has push
 * alerts on (the app in the background still gets the alert, D5 answer 3).
 */

/** Lookback and minimum sample size for "usually replies in X" (D5-10). */
const REPLY_TIME_LOOKBACK_DAYS = 30;
const REPLY_TIME_MIN_SAMPLES = 5;
const REPLY_TIME_MAX_SAMPLES = 500;
/** Heartbeat window that counts as "online now" (dashboard pings every 30 s). */
const ONLINE_WINDOW_MS = 120_000;

export interface ScheduleRules {
  timezone: string;
  weekly_hours: WeeklyInterval[];
  closures: BusinessHoursClosure[];
}

export interface AvailabilityScope {
  organizationId: string;
  /** Conversation channel ("web" or a channel plugin id). */
  channel: string;
}

// ---------------------------------------------------------------------------
// Pure schedule evaluation (timezone and DST aware, no I/O)
// ---------------------------------------------------------------------------

interface WallClock {
  year: number;
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

function wallClock(instant: number, timezone: string): WallClock {
  const parts = formatterFor(timezone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday") ?? "Sun"),
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** Local minus UTC, in ms, at that instant. */
function offsetAt(instant: number, timezone: string): number {
  const floored = Math.floor(instant / 60_000) * 60_000;
  const w = wallClock(floored, timezone);
  return Date.UTC(w.year, w.month - 1, w.day, 0, w.minutes) - floored;
}

/**
 * The instant a local wall time happens. In a DST overlap (the hour that runs
 * twice) the earlier one; in a DST gap (an hour that never happens) the time
 * shifted forward past the gap.
 */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  minutes: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const offsets = new Set([
    offsetAt(guess - 12 * 3_600_000, timezone),
    offsetAt(guess + 12 * 3_600_000, timezone),
  ]);
  const candidates = [...offsets].map((offset) => guess - offset);
  const exact = candidates.filter((t) => {
    const w = wallClock(t, timezone);
    return Date.UTC(w.year, w.month - 1, w.day, 0, w.minutes) === guess;
  });
  return new Date(exact.length ? Math.min(...exact) : Math.max(...candidates));
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isClosedOn(date: string, closures: BusinessHoursClosure[]): boolean {
  return closures.some((c) => date >= c.date && date <= (c.endDate || c.date));
}

/** Overnight = ends at or before it starts (runs past midnight). "24:00" is not overnight. */
function bounds(interval: WeeklyInterval): { start: number; end: number; overnight: boolean } {
  const start = toMinutes(interval.start);
  const end = toMinutes(interval.end);
  return { start, end, overnight: end <= start };
}

function isWithinWallClock(w: WallClock, rules: ScheduleRules): boolean {
  if (isClosedOn(isoDate(w.year, w.month, w.day), rules.closures)) return false;
  const yesterday = (w.weekday + 6) % 7;
  return rules.weekly_hours.some((interval) => {
    const { start, end, overnight } = bounds(interval);
    if (interval.day === w.weekday) {
      return overnight ? w.minutes >= start : w.minutes >= start && w.minutes < end;
    }
    // The tail of yesterday's overnight interval.
    return interval.day === yesterday && overnight && w.minutes < end;
  });
}

function formatLocal(w: WallClock): string {
  const hh = String(Math.floor(w.minutes / 60)).padStart(2, "0");
  const mm = String(w.minutes % 60).padStart(2, "0");
  return `${isoDate(w.year, w.month, w.day)}T${hh}:${mm}`;
}

/** How far ahead to look for the next opening (covers long closures). */
const NEXT_OPENING_HORIZON_DAYS = 400;

export interface ScheduleEvaluation {
  withinHours: boolean;
  nextOpening: Date | null;
  localTime: string;
  timezone: string;
}

/** Is the schedule open at `now`, and if not, when does it next open? */
export function evaluateSchedule(rules: ScheduleRules, now: Date): ScheduleEvaluation {
  const timezone = isValidTimeZone(rules.timezone) ? rules.timezone : DEFAULT_TIMEZONE;
  const safeRules = { ...rules, timezone };
  const nowMs = now.getTime();
  const current = wallClock(nowMs, timezone);
  const withinHours = isWithinWallClock(current, safeRules);
  const result = { withinHours, nextOpening: null, localTime: formatLocal(current), timezone };
  if (withinHours || rules.weekly_hours.length === 0) return result;

  for (let offset = 0; offset < NEXT_OPENING_HORIZON_DAYS; offset++) {
    const date = new Date(Date.UTC(current.year, current.month - 1, current.day + offset));
    const [year, month, day, weekday] = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      date.getUTCDay(),
    ];
    if (isClosedOn(isoDate(year, month, day), rules.closures)) continue;

    const yesterday = (weekday + 6) % 7;
    const starts = new Set<number>();
    for (const interval of rules.weekly_hours) {
      const { start, end, overnight } = bounds(interval);
      if (interval.day === weekday) starts.add(start);
      // Yesterday was closed but its overnight interval carries into today.
      if (interval.day === yesterday && overnight && end > 0) starts.add(0);
    }
    for (const start of [...starts].sort((a, b) => a - b)) {
      const instant = zonedTimeToInstant(year, month, day, start, timezone);
      if (instant.getTime() <= nowMs) continue;
      if (isWithinWallClock(wallClock(instant.getTime(), timezone), safeRules)) {
        return { ...result, nextOpening: instant };
      }
    }
  }
  return result;
}

/**
 * Median of `samples` (minutes). Null when there are fewer than the minimum,
 * so the widget hides the estimate instead of showing a guess.
 */
export function medianMinutes(samples: number[]): number | null {
  if (samples.length < REPLY_TIME_MIN_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.max(1, Math.round(median));
}

// ---------------------------------------------------------------------------
// Database-backed lookups
// ---------------------------------------------------------------------------

function schedules() {
  return AppDataSource.getRepository(BusinessHoursSchedule);
}

/** The channel's own schedule, else the organization default, else null. */
export function pickSchedule<T extends Pick<BusinessHoursSchedule, "channels">>(
  rows: T[],
  channel: string,
): T | null {
  return (
    rows.find((row) => row.channels.includes(channel)) ??
    rows.find((row) => row.channels.length === 0) ??
    null
  );
}

export async function findScheduleForChannel(
  scope: AvailabilityScope,
): Promise<BusinessHoursSchedule | null> {
  const rows = await schedules().find({
    where: { organization_id: scope.organizationId },
    order: { created_at: "ASC" },
  });
  return pickSchedule(rows, scope.channel);
}

/** Within hours for this channel? No schedule = always. */
export async function isWithinBusinessHours(
  scope: AvailabilityScope,
  now: Date = new Date(),
): Promise<boolean> {
  const schedule = await findScheduleForChannel(scope);
  return schedule ? evaluateSchedule(schedule, now).withinHours : true;
}

/**
 * Active members set to Available who are online now (heartbeat) or have at
 * least one device with push alerts on.
 */
export async function countReachableMembers(
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows: Array<{ count: string }> = await AppDataSource.query(
    `SELECT COUNT(*) AS count
       FROM user_organizations uo
       JOIN users u ON u.id = uo.user_id
      WHERE uo.organization_id = $1
        AND uo.is_active = true
        AND u.is_active = true
        AND u.status = 'available'
        AND (
          u.last_seen_at >= $2
          OR EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
        )`,
    [organizationId, new Date(now.getTime() - ONLINE_WINDOW_MS)],
  );
  return Number(rows[0]?.count ?? 0);
}

async function organizationTimezone(organizationId: string): Promise<string> {
  const rows: Array<{ timezone: string | null }> = await AppDataSource.query(
    `SELECT timezone FROM organizations WHERE id = $1`,
    [organizationId],
  );
  return rows[0]?.timezone || DEFAULT_TIMEZONE;
}

/** open | open_nobody_online | closed, with the next opening and local time. */
export async function getAvailability(
  scope: AvailabilityScope,
  now: Date = new Date(),
): Promise<Availability> {
  const schedule = await findScheduleForChannel(scope);
  const evaluation = evaluateSchedule(
    schedule ?? {
      timezone: await organizationTimezone(scope.organizationId),
      weekly_hours: [],
      closures: [],
    },
    now,
  );
  const withinHours = schedule ? evaluation.withinHours : true;
  const base = {
    nextOpening: withinHours ? null : evaluation.nextOpening,
    localTime: evaluation.localTime,
    timezone: evaluation.timezone,
    hasSchedule: !!schedule,
  };
  if (!withinHours) return { state: "closed", ...base };
  const reachable = await countReachableMembers(scope.organizationId, now);
  return { state: reachable > 0 ? "open" : "open_nobody_online", ...base };
}

/**
 * The organization's median time from hand-off to the first human reply, in
 * minutes, over the last 30 days, counting only hand-offs made within this
 * channel's business hours (an overnight wait is not a reply time). Null when
 * there is not enough data (D5-10).
 */
export async function typicalFirstReplyMinutes(
  scope: AvailabilityScope,
  now: Date = new Date(),
): Promise<number | null> {
  const rows: Array<{ handed_off_at: Date; first_reply_at: Date }> = await AppDataSource.query(
    `SELECT c.handed_off_at, MIN(m.created_at) AS first_reply_at
       FROM conversations c
       JOIN messages m ON m.conversation_id = c.id
                      AND m.type = $2
                      AND m.created_at >= c.handed_off_at
      WHERE c.organization_id = $1
        AND c.handed_off_at >= $3
        AND c.deleted_at IS NULL
      GROUP BY c.id, c.handed_off_at
      ORDER BY c.handed_off_at DESC
      LIMIT ${REPLY_TIME_MAX_SAMPLES}`,
    [
      scope.organizationId,
      MessageType.HUMAN_AGENT,
      new Date(now.getTime() - REPLY_TIME_LOOKBACK_DAYS * 86_400_000),
    ],
  );
  if (rows.length < REPLY_TIME_MIN_SAMPLES) return null;

  const schedule = await findScheduleForChannel(scope);
  const samples = rows
    .filter(
      (row) => !schedule || evaluateSchedule(schedule, new Date(row.handed_off_at)).withinHours,
    )
    .map(
      (row) =>
        (new Date(row.first_reply_at).getTime() - new Date(row.handed_off_at).getTime()) / 60_000,
    );
  return medianMinutes(samples);
}

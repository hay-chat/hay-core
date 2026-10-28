import { z } from "zod";

/**
 * One weekly opening interval in the schedule's local time.
 * `day`: 0 = Sunday … 6 = Saturday. Times are "HH:MM" (24 h). An `end` at or
 * before `start` runs past midnight into the next day (Fri 22:00–02:00 closes
 * Saturday 02:00); "24:00" as an end means midnight.
 */
export interface WeeklyInterval {
  day: number;
  start: string;
  end: string;
}

/** Whole local days the team is closed, from `date` to `endDate` (inclusive). */
export interface BusinessHoursClosure {
  date: string;
  endDate?: string | null;
  label?: string | null;
}

/**
 * - open: within hours and at least one teammate is reachable
 * - open_nobody_online: within hours but nobody reachable right now
 * - closed: outside hours (the AI keeps answering; the human queue waits)
 */
export type AvailabilityState = "open" | "open_nobody_online" | "closed";

export interface Availability {
  state: AvailabilityState;
  /** Next time the schedule opens; null when open now or when it never opens. */
  nextOpening: Date | null;
  /** Local wall clock now, "YYYY-MM-DDTHH:MM", in `timezone`. */
  localTime: string;
  timezone: string;
  /** False when no schedule covers the channel (treated as always within hours). */
  hasSchedule: boolean;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const weeklyIntervalSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    start: z.string().regex(TIME),
    end: z.string().regex(END_TIME),
  })
  .refine((i) => i.start !== i.end, {
    message: "An interval cannot start and end at the same time",
  });

export const closureSchema = z
  .object({
    date: z.string().regex(DATE),
    endDate: z.string().regex(DATE).nullish(),
    label: z.string().max(120).nullish(),
  })
  .refine((c) => !c.endDate || c.endDate >= c.date, { message: "endDate is before date" });

export function isValidTimeZone(timezone: string | null | undefined): timezone is string {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export const scheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().refine(isValidTimeZone, { message: "Unknown timezone" }),
  channels: z.array(z.string().trim().min(1).max(64)).max(50),
  weeklyHours: z.array(weeklyIntervalSchema).max(100),
  closures: z.array(closureSchema).max(200),
});

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

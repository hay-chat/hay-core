import { DEFAULT_TIMEZONE } from "@server/types/organization-settings.types";

export interface LocalTimeContext {
  /** IANA zone actually used (falls back to UTC when the stored one is invalid). */
  timezone: string;
  /** e.g. "Tuesday, 27 October 2026, between 14:00 and 15:00 (GMT-3)". */
  localTime: string;
}

/**
 * The organization's local date and hour, for the planner prompt.
 *
 * Hour precision on purpose: the planner prompt is the cached system block
 * (see anthropic.provider.ts), and a minute-level clock would change it, and
 * invalidate the transcript cache behind it, on every turn. An hour window is
 * enough for "today/tomorrow", weekday and greeting decisions; opening-hours
 * decisions will come from the business-hours service (D5-6), not the model.
 */
export function describeLocalTime(
  timezone: string | null | undefined,
  now: Date = new Date(),
): LocalTimeContext {
  const zone = isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const hour = Number(part("hour"));
  const pad = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  const offset = part("timeZoneName") || "GMT";

  return {
    timezone: zone,
    localTime: `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}, between ${pad(hour)} and ${pad(hour + 1)} (${offset})`,
  };
}

function isValidTimeZone(timezone: string | null | undefined): timezone is string {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

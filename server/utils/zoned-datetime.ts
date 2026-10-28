/**
 * Full date, time and UTC offset in a given IANA time zone, for documents a
 * third party reads (conversation PDF, dispute evidence): "2026-10-12 14:03:05 UTC+01:00".
 * An unknown zone falls back to UTC rather than throwing.
 */
export function formatZonedDateTime(
  date: Date | string | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const zone = safeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${utcOffset(get("timeZoneName"))}`;
}

/** The zone itself when Intl knows it, otherwise "UTC". */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Intl's "GMT+01:00" / "GMT" as "UTC+01:00" / "UTC+00:00". */
function utcOffset(longOffset: string): string {
  const offset = longOffset.replace(/^GMT/, "");
  return `UTC${offset || "+00:00"}`;
}

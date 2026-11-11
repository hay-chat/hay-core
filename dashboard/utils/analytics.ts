/** Formatting shared by the analytics reports. */

/** ISO instants, start-inclusive and end-exclusive. */
export interface ReportRange {
  startDate: string;
  endDate: string;
}

export const NO_VALUE = "—";

export function formatRate(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? NO_VALUE : `${value.toFixed(digits)}%`;
}

/** A CSAT average, out of 5. */
export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? NO_VALUE : value.toFixed(2);
}

export type DeltaUnit = "points" | "percent" | "score";

export interface Delta {
  /** Signed, formatted for display: "+3.2 pts", "-12%", "+0.15". */
  text: string;
  direction: "up" | "down" | "flat";
}

/**
 * Change from the previous period. `points` and `score` subtract; `percent` is
 * relative growth. Null when either side has no value, or growth from zero.
 */
export function describeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  unit: DeltaUnit,
): Delta | null {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  if (unit === "percent" && previous === 0) return null;

  const change = unit === "percent" ? ((current - previous) / previous) * 100 : current - previous;
  const digits = unit === "score" ? 2 : unit === "points" ? 1 : 0;
  const rounded = Number(change.toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  const suffix = unit === "points" ? " pts" : unit === "percent" ? "%" : "";
  return {
    text: `${sign}${rounded.toFixed(digits)}${suffix}`,
    direction: rounded > 0 ? "up" : rounded < 0 ? "down" : "flat",
  };
}

/** Green when the change is good, red when bad. */
export function deltaColor(
  delta: Delta | null,
  higherIsBetter = true,
): "green" | "red" | "default" {
  if (!delta || delta.direction === "flat") return "default";
  return (delta.direction === "up") === higherIsBetter ? "green" : "red";
}

export function downloadCsv(csv: string, filename: string): void {
  const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export interface QuotaBurnDown {
  /** Share of the plan's resolutions used, 0-100 (capped). Null without a quota. */
  usedShare: number | null;
  /** Whole days until the period ends, never negative. */
  daysLeft: number;
  /** Resolutions by the end of the period at the pace so far. */
  projected: number;
  /** The pace so far ends the period over the quota. */
  overPace: boolean;
}

/** How a billing period is going against the plan's included resolutions. */
export function quotaBurnDown(input: {
  billable: number;
  included: number | null;
  start: Date;
  /** Exclusive. */
  end: Date;
  now?: Date;
}): QuotaBurnDown {
  const now = input.now ?? new Date();
  const length = input.end.getTime() - input.start.getTime();
  const elapsed = Math.min(length, Math.max(0, now.getTime() - input.start.getTime()));
  // Too early to extrapolate from: the first hours would project wildly.
  const projected =
    length > 0 && elapsed / length >= 0.05
      ? Math.round(input.billable / (elapsed / length))
      : input.billable;
  const included = input.included;
  return {
    usedShare:
      included === null
        ? null
        : included > 0
          ? Math.min(100, (input.billable / included) * 100)
          : 100,
    daysLeft: Math.max(0, Math.ceil((input.end.getTime() - now.getTime()) / 86_400_000)),
    projected,
    overPace: included !== null && projected > included,
  };
}

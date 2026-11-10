/**
 * `calculate_date` core tool: date arithmetic done by code, because models get
 * weekdays and business-day counts wrong. It only costs a step on turns where
 * the planner needs a computed date, and takes several dates in one call so a
 * delivery window is one step, not two.
 */

import { describeLocalTime, localIsoDate } from "@server/orchestrator/local-time";
import type { CoreToolDefinition } from "./index";
import { READ_RISK } from "../tool-risk";

const LOCALES: Record<string, string> = { en: "en-GB", pt: "pt-BR", es: "es-ES" };
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_DAYS = 365;
const MAX_DATES = 6;

type Unit = "business_days" | "calendar_days";

/** Noon UTC stands for the calendar day, so adding days never crosses a zone or DST edge. */
function parseStart(from: string, timezone: string, now: Date): Date | null {
  const iso = from.trim().toLowerCase() === "today" ? localIsoDate(now, timezone) : from.trim();
  const dateOnly = DATE_ONLY.exec(iso);
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  }
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime())
    ? null
    : new Date(`${localIsoDate(instant, timezone)}T12:00:00Z`);
}

/** The start day is not counted; weekends are skipped for business days. */
export function addDays(start: Date, amount: number, unit: Unit): Date {
  const date = new Date(start);
  if (unit === "calendar_days") {
    date.setUTCDate(date.getUTCDate() + amount);
    return date;
  }
  let remaining = amount;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining--;
  }
  return date;
}

function formatLabel(date: Date, language: string | null | undefined): string {
  const locale = LOCALES[language ?? "en"] ?? language ?? "en-GB";
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(date);
  }
}

export const calculateDateTool: CoreToolDefinition = {
  name: "calculate_date",
  description:
    "Work out calendar dates: a start date plus a number of business or calendar days, and the " +
    "weekday of a date (add 0). Use it before stating a date you would otherwise have to compute, " +
    "such as a delivery window from a store's shipping policy. Ask for every date you need in one " +
    "call. Quote the returned label exactly. Weekends are skipped for business days; public " +
    "holidays are not, so present business-day results as an estimate.",
  risk: READ_RISK,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["dates"],
    properties: {
      dates: {
        type: "array",
        minItems: 1,
        maxItems: MAX_DATES,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["from", "add", "unit"],
          properties: {
            from: {
              type: "string",
              description: '"today", or a date or timestamp copied from a tool result.',
            },
            add: {
              type: "integer",
              minimum: 0,
              maximum: MAX_DAYS,
              description: "Days to add. The start day itself is not counted.",
            },
            unit: { type: "string", enum: ["business_days", "calendar_days"] },
          },
        },
      },
    },
  },

  async execute(conversation, args) {
    const requests = Array.isArray(args.dates) ? args.dates.slice(0, MAX_DATES) : [];
    const { timezone } = describeLocalTime(conversation.organization?.timezone);
    const now = new Date();

    const results = requests.map((request: Record<string, unknown>) => {
      const from = typeof request?.from === "string" ? request.from : "";
      const add = Number(request?.add);
      const unit: Unit = request?.unit === "calendar_days" ? "calendar_days" : "business_days";
      const start = parseStart(from, timezone, now);
      if (!start || !Number.isInteger(add) || add < 0 || add > MAX_DAYS) {
        return { from, add: request?.add, error: "Invalid start date or day count." };
      }
      const date = addDays(start, add, unit);
      return {
        from,
        add,
        unit,
        date: date.toISOString().slice(0, 10),
        label: formatLabel(date, conversation.language),
      };
    });

    return { results };
  },
};

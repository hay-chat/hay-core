import { localIsoDate } from "@server/orchestrator/local-time";

/**
 * Date check: catches wrong calendar dates in AI replies without asking an LLM.
 *
 * Models get weekdays and date arithmetic wrong, so a date in a reply must be
 * possible (31 November is not), carry the right weekday, and come from
 * somewhere: a tool result (calculate_date included), the conversation, a
 * document, or today, yesterday and tomorrow.
 *
 * Replies without a date cost one regex pass. English, Portuguese and Spanish
 * forms are recognized; anything else goes through unchecked. Relative phrases
 * ("by Friday", "next week") name no calendar date and are not checked.
 */

export type BadDateReason = "impossible" | "wrong_weekday" | "unsourced";

export interface BadDate {
  raw: string;
  reason: BadDateReason;
  /** wrong_weekday only: the weekday that date really falls on, in English. */
  actualWeekday?: string;
}

interface DateCandidate {
  day: number;
  month: number;
  year?: number;
}

export interface ReplyDate {
  raw: string;
  weekday?: number;
  /** One reading, or two when a numeric date could be day/month or month/day. */
  candidates: DateCandidate[];
}

const WEEKDAY_NAMES: Record<number, string[]> = {
  0: ["sunday", "sun", "domingo", "dom"],
  1: ["monday", "mon", "segunda-feira", "segunda", "seg", "lunes", "lun"],
  2: ["tuesday", "tues", "tue", "terca-feira", "terca", "ter", "martes"],
  3: ["wednesday", "wed", "quarta-feira", "quarta", "qua", "miercoles", "mie"],
  4: ["thursday", "thurs", "thur", "thu", "quinta-feira", "quinta", "qui", "jueves", "jue"],
  5: ["friday", "fri", "sexta-feira", "sexta", "sex", "viernes", "vie"],
  6: ["saturday", "sat", "sabado", "sab"],
};

const MONTH_NAMES: Record<number, string[]> = {
  1: ["january", "janeiro", "enero", "jan", "ene"],
  2: ["february", "fevereiro", "febrero", "feb", "fev"],
  3: ["march", "marco", "marzo", "mar"],
  4: ["april", "abril", "apr", "abr"],
  5: ["may", "maio", "mayo", "mai"],
  6: ["june", "junho", "junio", "jun"],
  7: ["july", "julho", "julio", "jul"],
  8: ["august", "agosto", "aug", "ago"],
  9: ["september", "setembro", "septiembre", "setiembre", "sept", "sep", "set"],
  10: ["october", "outubro", "octubre", "oct", "out"],
  11: ["november", "novembro", "noviembre", "nov"],
  12: ["december", "dezembro", "diciembre", "dec", "dez", "dic"],
};

/** Also everyday words ("3 out of 5", "1 may be"): only a month when written like one. */
const AMBIGUOUS_MONTHS = new Set(["may", "mar", "set", "out"]);

const ENGLISH_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function lookup(names: Record<number, string[]>): Map<string, number> {
  return new Map(
    Object.entries(names).flatMap(([value, words]) =>
      words.map((word): [string, number] => [word, Number(value)]),
    ),
  );
}

const WEEKDAY_BY_NAME = lookup(WEEKDAY_NAMES);
const MONTH_BY_NAME = lookup(MONTH_NAMES);

/** Longest first, so "segunda-feira" wins over "segunda". */
const alternation = (words: Iterable<string>) =>
  [...words].sort((a, b) => b.length - a.length).join("|");

const WD = `(?:${alternation(WEEKDAY_BY_NAME.keys())})`;
const MO = `(?:${alternation(MONTH_BY_NAME.keys())})`;
const ORD = `(?:st|nd|rd|th|º|°)?`;
// Not a piece of an amount, an order number or a clock time.
const D = `(?<![\\d#$€£./:-])(\\d{1,2})${ORD}(?![\\d:])`;
// The far end of a range follows its separator, so a hyphen in front is expected.
const D_END = `(\\d{1,2})${ORD}(?![\\d:])`;
const DAY_LEAD = `(?:(?:the|dia|el)\\s+)?`;
const WD_PREFIX = (group: string) => `(?:\\b(?<${group}>${WD})\\b\\.?,?\\s+${DAY_LEAD})?`;
const YEAR = `(?:,?\\s*(?:de\\s+)?(?<year>20\\d{2})\\b)?`;
const OF = `(?:\\s+(?:de|of))?\\s+`;

const RANGE_DAY_FIRST = new RegExp(
  `${WD_PREFIX("wd1")}${D}\\s*(?:-|–|—|\\bto\\b|\\band\\b|\\bthrough\\b|\\ba\\b|\\be\\b|\\by\\b|\\bate\\b|\\bal\\b)\\s*` +
    `${WD_PREFIX("wd2")}${D_END}${OF}\\b(?<month>${MO})\\b\\.?${YEAR}`,
  "gi",
);
const RANGE_MONTH_FIRST = new RegExp(
  `${WD_PREFIX("wd1")}\\b(?<month>${MO})\\b\\.?\\s+${D}\\s*(?:-|–|—|\\bto\\b|\\bthrough\\b)\\s*${D_END}${YEAR}`,
  "gi",
);
const SINGLE_DAY_FIRST = new RegExp(
  `${WD_PREFIX("wd1")}${D}${OF}\\b(?<month>${MO})\\b\\.?${YEAR}`,
  "gi",
);
const SINGLE_MONTH_FIRST = new RegExp(
  `${WD_PREFIX("wd1")}\\b(?<month>${MO})\\b\\.?\\s+${D}${YEAR}`,
  "gi",
);
const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
const FULL_NUMERIC = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;
// "24/7" and "3/5 stars" are not dates, so a short d/m needs a cue in front of it.
const SHORT_NUMERIC_CUED = new RegExp(
  `(?:\\b(?<wd1>${WD})\\b\\.?,?\\s+(?:dia\\s+)?|\\b(?:ate|by|until|on|dia|hasta|el)\\s+)(\\d{1,2})/(\\d{1,2})(?![\\d/])`,
  "gi",
);
const SHORT_NUMERIC = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g;

const TIMESTAMP =
  /\b(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?/g;

const stripAccents = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

function weekdayOf(word: string | undefined): number | undefined {
  return word ? WEEKDAY_BY_NAME.get(word.toLowerCase()) : undefined;
}

function monthOf(
  word: string,
  hasWeekday: boolean,
  year?: string,
  monthFirst = false,
): number | undefined {
  const lower = word.toLowerCase();
  if (AMBIGUOUS_MONTHS.has(lower) && !hasWeekday && !year) {
    // "set 2 of" lowercase is never a month; capitalized "Set 4" is a product name.
    if (word === lower || (monthFirst && lower !== "may")) return undefined;
  }
  return MONTH_BY_NAME.get(lower);
}

function numericCandidates(a: number, b: number, year?: number): DateCandidate[] {
  const readings: DateCandidate[] = [{ day: a, month: b, year }];
  if (a !== b) readings.push({ day: b, month: a, year });
  return readings.filter((reading) => reading.month >= 1 && reading.month <= 12);
}

/** Remove a matched span so a later, looser pattern does not read it again. */
function consume(text: string, pattern: RegExp, onMatch: (m: RegExpMatchArray) => void): string {
  return text.replace(pattern, (...args) => {
    // The callback ends with offset and string, then groups only if the pattern names any.
    const groups = typeof args[args.length - 1] === "object" ? args[args.length - 1] : undefined;
    const match = args.slice(0, groups ? -3 : -2) as unknown as RegExpMatchArray;
    match.groups = groups;
    match[0] = match[0].replace(/[\s.,]+$/, "");
    onMatch(match);
    return " ".repeat(String(args[0]).length);
  });
}

function extract(rawText: string, options: { bareNumeric: boolean }): ReplyDate[] {
  const found: ReplyDate[] = [];
  let text = stripAccents(rawText);

  text = consume(text, RANGE_DAY_FIRST, (m) => {
    const groups = m.groups ?? {};
    const hasWeekday = !!(groups.wd1 || groups.wd2);
    const month = monthOf(groups.month, hasWeekday, groups.year);
    if (!month) return;
    // Groups by position: wd1 and wd2 are named, so D1 and D2 are the numeric ones.
    const [first, second] = m.slice(1).filter((value) => /^\d{1,2}$/.test(value ?? ""));
    const year = groups.year ? Number(groups.year) : undefined;
    found.push(
      {
        raw: m[0],
        weekday: weekdayOf(groups.wd1),
        candidates: [{ day: Number(first), month, year }],
      },
      {
        raw: m[0],
        weekday: weekdayOf(groups.wd2),
        candidates: [{ day: Number(second), month, year }],
      },
    );
  });

  text = consume(text, RANGE_MONTH_FIRST, (m) => {
    const groups = m.groups ?? {};
    const month = monthOf(groups.month, !!groups.wd1, groups.year, true);
    if (!month) return;
    const [first, second] = m.slice(1).filter((value) => /^\d{1,2}$/.test(value ?? ""));
    const year = groups.year ? Number(groups.year) : undefined;
    found.push(
      {
        raw: m[0],
        weekday: weekdayOf(groups.wd1),
        candidates: [{ day: Number(first), month, year }],
      },
      { raw: m[0], candidates: [{ day: Number(second), month, year }] },
    );
  });

  for (const pattern of [SINGLE_DAY_FIRST, SINGLE_MONTH_FIRST]) {
    text = consume(text, pattern, (m) => {
      const groups = m.groups ?? {};
      const month = monthOf(
        groups.month,
        !!groups.wd1,
        groups.year,
        pattern === SINGLE_MONTH_FIRST,
      );
      if (!month) return;
      const [day] = m.slice(1).filter((value) => /^\d{1,2}$/.test(value ?? ""));
      found.push({
        raw: m[0],
        weekday: weekdayOf(groups.wd1),
        candidates: [
          { day: Number(day), month, year: groups.year ? Number(groups.year) : undefined },
        ],
      });
    });
  }

  text = consume(text, ISO_DATE, (m) => {
    found.push({
      raw: m[0],
      candidates: [{ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }],
    });
  });

  text = consume(text, FULL_NUMERIC, (m) => {
    const candidates = numericCandidates(Number(m[1]), Number(m[2]), Number(m[3]));
    if (candidates.length > 0) found.push({ raw: m[0], candidates });
  });

  text = consume(text, SHORT_NUMERIC_CUED, (m) => {
    const digits = m.slice(1).filter((value) => /^\d{1,2}$/.test(value ?? ""));
    const candidates = numericCandidates(Number(digits[0]), Number(digits[1]));
    if (candidates.length > 0) {
      found.push({ raw: m[0], weekday: weekdayOf(m.groups?.wd1), candidates });
    }
  });

  if (options.bareNumeric) {
    consume(text, SHORT_NUMERIC, (m) => {
      const candidates = numericCandidates(Number(m[1]), Number(m[2]));
      if (candidates.length > 0) found.push({ raw: m[0], candidates });
    });
  }

  return found;
}

/** Calendar dates stated in a reply. Empty for almost every reply. */
export function extractReplyDates(response: string): ReplyDate[] {
  return extract(response, { bareNumeric: false });
}

const utcDate = (year: number, month: number, day: number): Date | null => {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
};

const monthDayKey = (month: number, day: number) => `${month}-${day}`;

/** The real date a candidate means: its own year, or the nearest year to today. */
function resolveCandidate(candidate: DateCandidate, today: Date): Date | null {
  if (candidate.year) return utcDate(candidate.year, candidate.month, candidate.day);
  const year = today.getUTCFullYear();
  const dates = [year - 1, year, year + 1]
    .map((y) => utcDate(y, candidate.month, candidate.day))
    .filter((date): date is Date => date !== null);
  if (dates.length === 0) return null;
  return dates.reduce((best, date) =>
    Math.abs(date.getTime() - today.getTime()) < Math.abs(best.getTime() - today.getTime())
      ? date
      : best,
  );
}

/** Every month-day the context vouches for, in the shop's zone and in UTC. */
function collectSourceDates(texts: string[], timezone: string, now: Date): Set<string> {
  const keys = new Set<string>();
  const addIso = (iso: string) => {
    const [, month, day] = iso.split("-").map(Number);
    keys.add(monthDayKey(month, day));
  };

  for (const offset of [-1, 0, 1]) {
    addIso(localIsoDate(new Date(now.getTime() + offset * 86_400_000), timezone));
  }

  for (const text of texts) {
    for (const match of text.matchAll(TIMESTAMP)) {
      keys.add(monthDayKey(Number(match[2]), Number(match[3])));
      if (!match[4]) continue;
      const instant = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}${match[5] ?? "Z"}`);
      if (!Number.isNaN(instant.getTime())) addIso(localIsoDate(instant, timezone));
    }
    for (const date of extract(text, { bareNumeric: true })) {
      for (const candidate of date.candidates) {
        keys.add(monthDayKey(candidate.month, candidate.day));
      }
    }
  }
  return keys;
}

export interface DateAssessmentInput {
  dates: ReplyDate[];
  /** Text the reply may legitimately take dates from. Never the AI's own earlier replies. */
  contextTexts: string[];
  timezone: string;
  now?: Date;
}

export function assessReplyDates({
  dates,
  contextTexts,
  timezone,
  now = new Date(),
}: DateAssessmentInput): BadDate[] {
  const [year, month, day] = localIsoDate(now, timezone).split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day, 12));
  const sources = collectSourceDates(contextTexts, timezone, now);

  const bad: BadDate[] = [];
  for (const date of dates) {
    const readings = date.candidates
      .map((candidate) => ({ candidate, resolved: resolveCandidate(candidate, today) }))
      .filter((reading): reading is typeof reading & { resolved: Date } => !!reading.resolved);

    if (readings.length === 0) {
      bad.push({ raw: date.raw, reason: "impossible" });
      continue;
    }

    if (
      date.weekday !== undefined &&
      !readings.some((reading) => reading.resolved.getUTCDay() === date.weekday)
    ) {
      bad.push({
        raw: date.raw,
        reason: "wrong_weekday",
        actualWeekday: ENGLISH_WEEKDAYS[readings[0].resolved.getUTCDay()],
      });
      continue;
    }

    const sourced = readings.some(({ candidate }) =>
      sources.has(monthDayKey(candidate.month, candidate.day)),
    );
    if (!sourced) bad.push({ raw: date.raw, reason: "unsourced" });
  }
  return bad;
}

/** Sources are incomplete at first, so unsourced dates are only logged until this is on. */
export function isUnsourcedDateEnforced(): boolean {
  return process.env.DATE_GUARD_UNSOURCED === "enforce";
}

/**
 * Shared helpers for the Spacebring tools: MCP responses, lenient text
 * matching, and date/time parsing in the location's time zone.
 *
 * The tools take what a member says ("orange room", "tomorrow", "2pm",
 * "90 minutes") and normalise it here, so the agent never has to translate
 * a request into Spacebring's ids and UTC timestamps itself.
 */

const { toolError, toolErrorResult } = require("@hay/plugin-sdk/tool-errors");

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload ?? null, null, 2) }] };
}

/**
 * Anything thrown in a handler becomes JSON `{ code, retryable, message, details? }`.
 * Uncoded errors become INTERNAL, so every expected failure throws a ToolError.
 */
const fail = toolErrorResult;

/** Wrap a handler so every throw becomes a coded MCP error result. */
const handle = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

// ─────────────────────────────── text ───────────────────────────────

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function norm(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

/**
 * Find one item by id or by name, leniently. Returns `{ match, candidates }`:
 * `match` when exactly one item fits (exact id, exact name, or the only
 * partial match), otherwise the partial matches so the caller can ask.
 */
function matchByName(items, query, nameOf) {
  const q = norm(query);
  if (!q) return { match: null, candidates: [] };
  const byId = items.find((it) => String(it.id) === String(query).trim());
  if (byId) return { match: byId, candidates: [byId] };
  const exact = items.filter((it) => norm(nameOf(it)) === q);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  const tokens = q.split(" ");
  const partial = items.filter((it) => {
    const name = norm(nameOf(it));
    return tokens.every((t) => name.includes(t));
  });
  if (partial.length === 1) return { match: partial[0], candidates: partial };
  return { match: null, candidates: exact.length ? exact : partial };
}

/** Lenient email: trims, lowercases, rejects only what cannot be an address. */
function cleanEmail(value, field = "member_email") {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw toolError(
      "BAD_INPUT",
      `"${value ?? ""}" is not an email address. Ask the member for the email they use to sign in to Spacebring.`,
      { details: { field } },
    );
  }
  return email;
}

// ─────────────────────────────── time ───────────────────────────────

function validTimeZone(tz) {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Wall-clock parts of `date` in `tz`. */
function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `tz` (DST-safe). */
function zonedToUtc({ year, month, day }, minutes, tz) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const first = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(first), tz);
  return new Date(second);
}

const RELATIVE_DAYS = {
  today: 0,
  hoje: 0,
  hoy: 0,
  tomorrow: 1,
  amanha: 1,
  manana: 1,
};

/**
 * A calendar day from "2026-11-04", "today"/"tomorrow" (also pt/es), or an ISO
 * timestamp (its date part in the location's time zone).
 */
function parseDay(input, tz, now = new Date()) {
  const raw = String(input ?? "").trim();
  const key = norm(raw);
  if (key in RELATIVE_DAYS) {
    const today = zonedParts(now, tz);
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + RELATIVE_DAYS[key]));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !Number.isNaN(Date.parse(raw))) {
    const p = zonedParts(new Date(raw), tz);
    return { year: p.year, month: p.month, day: p.day };
  }
  throw toolError(
    "BAD_INPUT",
    `Could not read the date "${raw}". Pass it as YYYY-MM-DD (e.g. 2026-11-04), "today" or "tomorrow".`,
    { details: { field: "date" } },
  );
}

/** Minutes after midnight from "14:00", "14h", "14h30", "2pm", "2:30 pm", "9". */
function parseTime(input, field = "start_time") {
  const raw = String(input ?? "")
    .trim()
    .toLowerCase();
  const m = raw.match(/^(\d{1,2})(?:\s*[:h.]\s*(\d{2})?)?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (m) {
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3]?.[0];
    if (meridiem === "p" && hour < 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) return hour * 60 + minute;
  }
  throw toolError(
    "BAD_INPUT",
    `Could not read the time "${input ?? ""}". Pass it as HH:MM in the space's local time (e.g. 14:30).`,
    { details: { field } },
  );
}

/**
 * Turn the member's words into a UTC window: a day plus a start time, and an
 * end time or a duration (default 60 minutes). An end time at or before the
 * start time is refused rather than guessed as running past midnight.
 */
function resolveWindow({ date, start_time, end_time, duration_minutes }, tz, now = new Date()) {
  const day = parseDay(date, tz, now);
  const startMin = parseTime(start_time, "start_time");
  let endMin;
  if (end_time !== undefined && end_time !== null && end_time !== "") {
    endMin = parseTime(end_time, "end_time");
    if (endMin <= startMin) {
      throw toolError(
        "BAD_INPUT",
        `The end time (${end_time}) is not after the start time (${start_time}). Check the times with the member.`,
        { details: { field: "end_time" } },
      );
    }
  } else {
    const minutes = Number(duration_minutes ?? 60);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      throw toolError("BAD_INPUT", "duration_minutes must be between 1 and 1440.", {
        details: { field: "duration_minutes" },
      });
    }
    endMin = startMin + Math.round(minutes);
  }
  const start = zonedToUtc(day, startMin, tz);
  const end = zonedToUtc(day, endMin, tz);
  return { start, end };
}

/** "Tue, 4 Nov 2026, 14:00" in `tz`. */
function formatLocal(value, tz) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" at ", ", ");
}

/** "14:00" in `tz`. */
function formatClock(value, tz) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "Tue, 4 Nov 2026, 14:00–15:00" in `tz`. */
function formatRange(start, end, tz) {
  return `${formatLocal(start, tz)}–${formatClock(end, tz)}`;
}

/** "2026-11-04": the calendar day of an instant in `tz`. */
function localDayKey(value, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(value));
}

/** True when [aStart, aEnd) and [bStart, bEnd) share any instant. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

module.exports = {
  ok,
  fail,
  handle,
  norm,
  matchByName,
  cleanEmail,
  validTimeZone,
  zonedParts,
  zonedToUtc,
  parseDay,
  parseTime,
  resolveWindow,
  formatLocal,
  formatClock,
  formatRange,
  localDayKey,
  overlaps,
};

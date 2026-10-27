/**
 * Shared MCP response helpers plus Nuvemshop-shape helpers.
 *
 * Nuvemshop i18n fields (product name/description/handle, attribute names,
 * variant values, category names) are objects keyed by language code
 * ({"es": …, "pt": …, "en": …}) even on single-language stores. `pickLang`
 * flattens them to one language so the agent reads a single translation.
 */

const { mainLanguage } = require("./client");

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload ?? null, null, 2) }] };
}

function fail(err) {
  return {
    content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }],
    isError: true,
  };
}

/** Nuvemshop money fields are decimal strings; read as float, 0 when absent. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Pick one language from an i18n object field (string fields pass through). */
function pickLang(field, lang) {
  if (field === null || field === undefined) return null;
  if (typeof field === "string") return field;
  const candidates = [lang, mainLanguage(), "pt", "es", "en", ...Object.keys(field)];
  for (const key of candidates) {
    if (key && typeof field[key] === "string" && field[key].length > 0) return field[key];
  }
  return null;
}

const sameEmail = (a, b) =>
  Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const digits = (s) => String(s || "").replace(/\D/g, "");
/** The part of a phone number that survives formatting differences (+55, spaces, DDD). */
const phoneKey = (phone) => digits(phone).slice(-8);
const samePhone = (a, b) => {
  const ka = phoneKey(a);
  return ka.length === 8 && ka === phoneKey(b);
};

/**
 * MCP tool annotations. Core caches them from tools/list
 * (server/services/plugin-tools.service.ts) and the dashboard classifies
 * read / write / destructive from them (dashboard/utils/toolClassification.ts).
 */
const READ = Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
const WRITE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
});
const DESTRUCTIVE = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
});

module.exports = {
  READ,
  WRITE,
  DESTRUCTIVE,
  ok,
  fail,
  num,
  round2,
  pickLang,
  sameEmail,
  samePhone,
  phoneKey,
  digits,
};

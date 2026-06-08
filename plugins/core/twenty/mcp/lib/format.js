/**
 * Shared response/body helpers for the Twenty MCP tools.
 */

const crypto = require("crypto");

/** Build a successful MCP tool response wrapping a JSON payload. */
function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Build an error MCP tool response. */
function fail(err) {
  return {
    content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }],
    isError: true,
  };
}

/**
 * Twenty wraps every REST payload under `data`, keyed by the object name
 * (`data.people`, `data.person`, `data.createPerson`, …). For generic tools we
 * don't always know that key, so unwrap the single value under `data`.
 */
function unwrapData(response) {
  const data = response?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1) return data[keys[0]];
    return data;
  }
  return data ?? response;
}

/** Extract `{ hasNextPage, endCursor }` pagination info from a list response. */
function pageInfo(response) {
  const info = response?.pageInfo || {};
  return {
    hasNextPage: Boolean(info.hasNextPage),
    nextCursor: info.hasNextPage ? (info.endCursor ?? null) : null,
  };
}

/**
 * Build Twenty's rich-text body shape (`bodyV2`) from plain text. Notes and
 * tasks store a BlockNote JSON document alongside a markdown mirror.
 */
function buildBlockNote(text) {
  const value = text || "";
  return {
    blocknote: JSON.stringify([
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
        content: value ? [{ type: "text", text: value, styles: {} }] : [],
        children: [],
      },
    ]),
    markdown: value,
  };
}

/** Build a Twenty LINKS field value (used by domainName, linkedinLink, …). */
function buildLink(url) {
  return { primaryLinkUrl: url, primaryLinkLabel: "", secondaryLinks: [] };
}

/**
 * Compose Twenty filter clauses into a single expression.
 * A single clause is passed through; multiple clauses are AND-combined.
 */
function andFilter(clauses) {
  const present = clauses.filter(Boolean);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return `and(${present.join(",")})`;
}

module.exports = { ok, fail, unwrapData, pageInfo, buildBlockNote, buildLink, andFilter };

/**
 * Shared response/body helpers for the Wix MCP tools.
 */

/** Build a successful MCP tool response wrapping a JSON payload. */
function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload ?? null, null, 2) }],
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
 * Extract `{ hasNext, nextCursor }` from a Wix list/search response. Wix returns
 * paging under either `metadata` or `pagingMetadata`, with the forward cursor at
 * `cursors.next`.
 */
function cursorInfo(response) {
  const meta = response?.pagingMetadata || response?.metadata || {};
  const next = meta?.cursors?.next ?? null;
  const hasNext = typeof meta.hasNext === "boolean" ? meta.hasNext : Boolean(next);
  return { hasNext, nextCursor: hasNext ? next : null };
}

/**
 * Build a Wix Price object from a plain decimal string (e.g. "10.50"). Wix money
 * fields in request bodies are `{ amount }` in major currency units; the
 * currency is taken from the order, so it is not sent here.
 */
function money(value) {
  return { amount: String(value) };
}

/** Read a Wix Price/Money object (or a bare string/number) as a float; 0 when absent. */
function amountOf(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "object") return amountOf(value.amount ?? value.value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to cents to avoid float noise in sums/comparisons. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { ok, fail, cursorInfo, money, amountOf, round2 };

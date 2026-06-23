/**
 * Shared response/body helpers for the Wix MCP tools.
 */

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
 * Extract `{ hasNext, nextCursor }` from a Wix list/search response. Wix returns
 * paging under either `metadata` or `pagingMetadata`, with the forward cursor at
 * `cursors.next`.
 */
function cursorInfo(response) {
  const meta = response?.pagingMetadata || response?.metadata || {};
  const next = meta?.cursors?.next ?? null;
  // `hasNext` is sometimes explicit, otherwise inferred from the presence of a cursor.
  const hasNext = typeof meta.hasNext === "boolean" ? meta.hasNext : Boolean(next);
  return { hasNext, nextCursor: hasNext ? next : null };
}

/**
 * Build a Wix Money object from a plain decimal string (e.g. "10.50"). Wix money
 * fields in request bodies are `{ value }` objects in major currency units; the
 * currency is taken from the order, so it is not sent here.
 */
function money(value) {
  return { amount: String(value) };
}

module.exports = { ok, fail, cursorInfo, money };

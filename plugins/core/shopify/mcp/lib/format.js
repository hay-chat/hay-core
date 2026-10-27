/**
 * Shared MCP response + GraphQL helpers for the Shopify tools.
 */

const { toolError, toolErrorResult } = require("@hay/plugin-sdk/tool-errors");

/** Wrap a successful result as MCP text content (pretty JSON). */
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] };
}

/**
 * Wrap anything thrown in a tool handler as an MCP error result: JSON
 * `{ code, retryable, message, details? }` from the shared plugin-SDK vocabulary.
 * Uncoded errors become INTERNAL, so every expected failure must throw a ToolError.
 */
const fail = toolErrorResult;

/** Flatten a GraphQL connection (`{ nodes }` or `{ edges { node } }`) to an array. */
function unwrapConnection(conn) {
  if (!conn) return [];
  if (Array.isArray(conn.nodes)) return conn.nodes;
  if (Array.isArray(conn.edges)) return conn.edges.map((e) => e && e.node).filter(Boolean);
  return [];
}

/** Extract `{ hasNextPage, endCursor }` from a connection. */
function pageInfo(conn) {
  const info = conn && conn.pageInfo;
  return {
    hasNextPage: !!(info && info.hasNextPage),
    endCursor: (info && info.endCursor) || null,
  };
}

/**
 * Normalise a bare numeric id to a Shopify GID, passing existing GIDs through.
 * @param {string} type - e.g. "Order", "Customer", "Product", "ProductVariant"
 * @param {string|number} id
 */
function toGid(type, id) {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${type}/${s}`;
}

/**
 * Throw PROVIDER_REFUSED if a mutation payload returned userErrors. Pass the
 * payload object (e.g. `data.orderCancel`) and the field name that holds them.
 */
function assertNoUserErrors(payload, field = "userErrors") {
  const errors = payload && payload[field];
  if (Array.isArray(errors) && errors.length > 0) {
    const reasons = errors.map((e) => (e && e.message) || "").filter(Boolean);
    throw toolError(
      "PROVIDER_REFUSED",
      `Shopify refused: ${reasons.join("; ") || "no reason given"}`,
      {
        details: { userErrors: errors },
      },
    );
  }
}

module.exports = { ok, fail, toolError, unwrapConnection, pageInfo, toGid, assertNoUserErrors };

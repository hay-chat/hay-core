/**
 * Shared MCP response + GraphQL helpers for the Shopify tools.
 */

/** Wrap a successful result as MCP text content (pretty JSON). */
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data ?? null, null, 2) }] };
}

/** Wrap an error as an MCP error result. */
function fail(err) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

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
 * Throw if a mutation payload returned userErrors. Pass the payload object
 * (e.g. `data.orderCancel`) and the field name that holds the errors.
 */
function assertNoUserErrors(payload, field = "userErrors") {
  const errors = payload && payload[field];
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`Shopify rejected the request: ${JSON.stringify(errors)}`);
  }
}

module.exports = { ok, fail, unwrapConnection, pageInfo, toGid, assertNoUserErrors };

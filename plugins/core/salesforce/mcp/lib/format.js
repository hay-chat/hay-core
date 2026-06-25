/**
 * Shared response helpers for the Salesforce MCP tools.
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

module.exports = { ok, fail };

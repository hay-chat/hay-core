/**
 * Shared MCP response helpers for the Melhor Envio tools.
 */

const { toolErrorResult } = require("@hay/plugin-sdk/tool-errors");

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload ?? null, null, 2) }] };
}

/**
 * Wrap a handler so its return value becomes an MCP result and every throw a
 * coded error result `{ code, retryable, message, details? }` (uncoded errors
 * become INTERNAL, so every expected failure throws a ToolError).
 */
const handle = (fn) => async (args, extra) => {
  try {
    return ok(await fn(args, extra));
  } catch (err) {
    return toolErrorResult(err);
  }
};

/** Drop null, undefined and empty-string fields so the agent reads only what is known. */
function compact(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || value === "") continue;
    out[key] = value;
  }
  return out;
}

module.exports = { ok, handle, compact };

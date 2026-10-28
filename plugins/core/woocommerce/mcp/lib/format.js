/**
 * Shared MCP response helpers for the WooCommerce tools.
 */

const { toolError, toolErrorResult } = require("@hay/plugin-sdk/tool-errors");

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload ?? null, null, 2) }] };
}

/**
 * Wrap anything thrown in a tool handler as an MCP error result: JSON
 * `{ code, retryable, message, details? }` from the shared plugin-SDK vocabulary.
 * Uncoded errors become INTERNAL, so every expected failure must throw a ToolError.
 */
const fail = toolErrorResult;

/** WooCommerce money fields are decimal strings; read as float, 0 when absent. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { ok, fail, toolError, num, round2 };

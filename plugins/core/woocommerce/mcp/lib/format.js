/**
 * Shared MCP response helpers for the WooCommerce tools.
 */

function ok(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload ?? null, null, 2) }] };
}

function fail(err) {
  return {
    content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }],
    isError: true,
  };
}

/** WooCommerce money fields are decimal strings; read as float, 0 when absent. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { ok, fail, num, round2 };

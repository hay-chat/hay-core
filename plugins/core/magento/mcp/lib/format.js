/**
 * Shared MCP response helpers for the Magento tools.
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

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Magento ships product fields in `custom_attributes: [{attribute_code, value}]`. */
function customAttributes(product) {
  const out = {};
  for (const attr of product?.custom_attributes || []) {
    if (attr?.attribute_code) out[attr.attribute_code] = attr.value;
  }
  return out;
}

module.exports = { ok, fail, num, round2, customAttributes };

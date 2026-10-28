/**
 * Return instructions (D6-13).
 *
 *   woocommerce_get_return_instructions   the merchant's "How to return" setting
 *
 * No label or carrier integration: the agent relays the merchant's own text.
 */

const {
  returnInstructionsResult,
  TOOL_DESCRIPTION,
} = require("@hay/plugin-sdk/return-instructions");
const { ok } = require("../lib/format");

function registerReturnTools(server) {
  server.tool("woocommerce_get_return_instructions", TOOL_DESCRIPTION, {}, async () =>
    ok(returnInstructionsResult()),
  );
}

module.exports = { registerReturnTools };

/**
 * Return instructions (D6-13).
 *
 *   nuvemshop_get_return_instructions   the merchant's "How to return" setting
 *
 * No label or carrier integration: the agent relays the merchant's own text.
 */

const {
  returnInstructionsResult,
  TOOL_DESCRIPTION,
} = require("@hay/plugin-sdk/return-instructions");
const { ok, READ } = require("../lib/format");

function registerReturnTools(server) {
  server.registerTool(
    "nuvemshop_get_return_instructions",
    { description: TOOL_DESCRIPTION, inputSchema: {}, annotations: READ },
    async () => ok(returnInstructionsResult()),
  );
}

module.exports = { registerReturnTools };

/**
 * D6-13 "How to return" owner setting, shared by the commerce plugins.
 *
 * The merchant writes their return process (text and/or a link) in the plugin
 * settings; the plugin passes it to its MCP server as RETURN_INSTRUCTIONS. The
 * agent relays it as written. There is no label or carrier integration: when
 * nothing is set the agent must hand off instead of inventing a process.
 */

const ENV_VAR = "RETURN_INSTRUCTIONS";
const MAX_LENGTH = 2000;

/** The configured instructions, or null when the merchant has not set any. */
function readReturnInstructions(env = process.env) {
  const text = String(env[ENV_VAR] ?? "").trim();
  return text ? text.slice(0, MAX_LENGTH) : null;
}

/** Tool result for `<platform>_get_return_instructions`. */
function returnInstructionsResult(env = process.env) {
  const instructions = readReturnInstructions(env);
  return instructions
    ? {
        configured: true,
        instructions,
        relay:
          "Give the customer these instructions as written. Do not add steps, labels, " +
          "addresses or deadlines that are not in them.",
      }
    : {
        configured: false,
        instructions: null,
        relay:
          "The store has not set return instructions. Do not describe a return process: " +
          "hand the conversation to the store team.",
      };
}

const TOOL_DESCRIPTION =
  "Get the store's own instructions for how to return an item (the merchant's return " +
  "process, address or link). Call it whenever the customer asks how to return or exchange " +
  "something, and relay the instructions as written. configured=false means the store has " +
  "not set any: hand off instead of inventing a process.";

module.exports = {
  ENV_VAR,
  MAX_LENGTH,
  readReturnInstructions,
  returnInstructionsResult,
  TOOL_DESCRIPTION,
};

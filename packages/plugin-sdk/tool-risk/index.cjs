/**
 * Tool risk classification for plugin MCP tools.
 *
 * Every tool a plugin registers should say whether it only reads, and if it
 * writes, what kind of write it is. Hay.chat core reads this from the cached
 * tools/list result to decide whether a call may run straight away, must be
 * simulated (playground dry-run) or must wait for a human's approval.
 *
 * The result rides on standard MCP fields:
 *   annotations.readOnlyHint / annotations.destructiveHint
 *   _meta["chat.hay/category"]  (write tools only)
 *
 * A tool the plugin does not classify gets no annotations, and core treats it
 * as an unknown write (the safe default).
 *
 * Plain CommonJS with no dependencies, like ../tool-errors: local MCP servers
 * are CommonJS scripts spawned with `node`.
 */

const CATEGORY_META_KEY = "chat.hay/category";

/** Write categories core understands. Anything else reads as "other_write". */
const WRITE_CATEGORIES = Object.freeze({
  refund: { destructive: true },
  cancel: { destructive: true },
  discount: { destructive: true },
  return: { destructive: false },
  address_change: { destructive: true },
  customer_update: { destructive: true },
  note: { destructive: false },
  other_write: { destructive: true },
});

/**
 * The MCP annotations + _meta for one tool, or null when the spec does not
 * mention it.
 *
 * @param {string} name
 * @param {{ read: string[], write: Record<string, string> }} spec
 */
function riskFor(name, spec) {
  if (spec.read.includes(name)) {
    return { annotations: { readOnlyHint: true, destructiveHint: false } };
  }
  const category = spec.write[name];
  if (!category) return null;
  if (!WRITE_CATEGORIES[category]) {
    throw new Error(`Unknown tool category "${category}" for ${name}`);
  }
  return {
    annotations: { readOnlyHint: false, destructiveHint: WRITE_CATEGORIES[category].destructive },
    _meta: { [CATEGORY_META_KEY]: category },
  };
}

/**
 * Make every later `server.tool(...)` registration carry its risk class.
 * Mutates and returns the server. Fakes whose `tool()` returns nothing (test
 * harnesses) are left alone.
 *
 * @template T
 * @param {T} server an McpServer
 * @param {{ read: string[], write: Record<string, string> }} spec
 * @returns {T}
 */
function applyToolRisk(server, spec) {
  const register = server.tool.bind(server);
  server.tool = (...args) => {
    const registered = register(...args);
    const risk = riskFor(args[0], spec);
    if (risk && registered && typeof registered.update === "function") {
      registered.update(risk);
    }
    return registered;
  };
  return server;
}

module.exports = { CATEGORY_META_KEY, WRITE_CATEGORIES, riskFor, applyToolRisk };

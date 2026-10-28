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

/** @param {unknown} category */
function isWriteCategory(category) {
  return (
    typeof category === "string" && Object.prototype.hasOwnProperty.call(WRITE_CATEGORIES, category)
  );
}

/**
 * The MCP annotations + _meta for one tool, or null when the spec does not
 * mention it.
 *
 * @param {string} name
 * @param {{ read?: string[], write?: Record<string, string> }} spec
 */
function riskFor(name, spec) {
  if ((spec.read || []).includes(name)) {
    return { annotations: { readOnlyHint: true, destructiveHint: false } };
  }
  const write = spec.write || {};
  const category = Object.prototype.hasOwnProperty.call(write, name) ? write[name] : undefined;
  if (!category) return null;
  if (!isWriteCategory(category)) {
    throw new Error(`Unknown tool category "${category}" for ${name}`);
  }
  return {
    annotations: { readOnlyHint: false, destructiveHint: WRITE_CATEGORIES[category].destructive },
    _meta: { [CATEGORY_META_KEY]: category },
  };
}

/**
 * Check a risk spec once, where the plugin declares it, so a typo fails loudly
 * at startup instead of leaving a tool unclassified. `read` and `write` are
 * both optional. Returns the spec with both present.
 *
 * @param {{ read?: string[], write?: Record<string, string> } | undefined} spec
 * @returns {{ read: string[], write: Record<string, string> }}
 */
function normalizeToolRiskSpec(spec) {
  if (spec === undefined || spec === null) return { read: [], write: {} };
  if (typeof spec !== "object") throw new Error("toolRisk must be an object");
  const read = spec.read ?? [];
  const write = spec.write ?? {};
  if (!Array.isArray(read) || read.some((name) => typeof name !== "string")) {
    throw new Error("toolRisk.read must be an array of tool names");
  }
  if (typeof write !== "object" || Array.isArray(write)) {
    throw new Error("toolRisk.write must map tool names to a category");
  }
  for (const [name, category] of Object.entries(write)) {
    if (!isWriteCategory(category)) {
      throw new Error(`Unknown tool category "${category}" for ${name}`);
    }
    if (read.includes(name)) {
      throw new Error(`Tool ${name} is declared both read and write`);
    }
  }
  return { read, write };
}

/**
 * Merge a plugin's declared risk into tool descriptors from tools/list. Used
 * for servers whose tools/list the plugin cannot edit (a hosted MCP server,
 * an in-process server). A declared tool takes the declaration, which wins
 * over whatever the server says. Any other tool is left as the server sent it,
 * so a hosted server's own `readOnlyHint` still counts and an unknown write
 * stays unclassified (held).
 *
 * @template {{ name: string, annotations?: object, _meta?: object }} T
 * @param {T[]} tools
 * @param {{ read?: string[], write?: Record<string, string> } | undefined} spec
 * @returns {T[]}
 */
function withToolRisk(tools, spec) {
  const normalized = normalizeToolRiskSpec(spec);
  return tools.map((tool) => {
    const risk = tool && typeof tool.name === "string" ? riskFor(tool.name, normalized) : null;
    if (!risk) return tool;
    const merged = { ...tool, annotations: { ...(tool.annotations || {}), ...risk.annotations } };
    if (risk._meta) merged._meta = { ...(tool._meta || {}), ...risk._meta };
    return merged;
  });
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

module.exports = {
  CATEGORY_META_KEY,
  WRITE_CATEGORIES,
  riskFor,
  applyToolRisk,
  normalizeToolRiskSpec,
  withToolRisk,
};

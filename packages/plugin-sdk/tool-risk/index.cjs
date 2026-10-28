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
 * A money tool that enforces a merchant-set cap itself (e.g. a goodwill coupon
 * capped at 10%) can say so with `capped: [name]` in the spec. That sets
 * _meta["chat.hay/capEnforced"] = true, and core lets calls within the cap run
 * without approval. Above the cap the tool must refuse with the NEEDS_APPROVAL
 * tool error; core then holds the call for a person, and an approved retry
 * reaches the tool with the `approvalArg` argument filled in by core.
 *
 * A tool the plugin does not classify gets no annotations, and core treats it
 * as an unknown write (the safe default).
 *
 * Plain CommonJS with no dependencies, like ../tool-errors: local MCP servers
 * are CommonJS scripts spawned with `node`.
 */

const CATEGORY_META_KEY = "chat.hay/category";
const CAP_ENFORCED_META_KEY = "chat.hay/capEnforced";
/**
 * Argument a capped tool declares (optional string) to learn that a person
 * approved this exact call. Core always overwrites it: empty on normal calls,
 * the pending action id on an approved retry. The model can never set it.
 */
const APPROVAL_ARG = "hay_approval_id";

/** Write categories core understands. Anything else reads as "other_write". */
const WRITE_CATEGORIES = Object.freeze({
  refund: { destructive: true },
  cancel: { destructive: true },
  discount: { destructive: true },
  // Swapping or exchanging items ships goods or changes what the shopper paid for.
  exchange: { destructive: true },
  return: { destructive: false },
  address_change: { destructive: true },
  customer_update: { destructive: true },
  note: { destructive: false },
  // Deletes data, changes how the account is set up (helpdesk triggers), or
  // cannot be taken back (a cancelled booking, submitted dispute evidence).
  // Core always holds it for approval while approval is on.
  destructive: { destructive: true },
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
 * @param {{ read?: string[], write?: Record<string, string>, capped?: string[] }} spec
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
  const _meta = { [CATEGORY_META_KEY]: category };
  if ((spec.capped || []).includes(name)) _meta[CAP_ENFORCED_META_KEY] = true;
  return {
    annotations: { readOnlyHint: false, destructiveHint: WRITE_CATEGORIES[category].destructive },
    _meta,
  };
}

/**
 * Check a risk spec once, where the plugin declares it, so a typo fails loudly
 * at startup instead of leaving a tool unclassified. `read`, `write` and
 * `capped` are all optional. Returns the spec with all three present.
 *
 * @param {{ read?: string[], write?: Record<string, string>, capped?: string[] } | undefined} spec
 * @returns {{ read: string[], write: Record<string, string>, capped: string[] }}
 */
function normalizeToolRiskSpec(spec) {
  if (spec === undefined || spec === null) return { read: [], write: {}, capped: [] };
  if (typeof spec !== "object") throw new Error("toolRisk must be an object");
  const read = spec.read ?? [];
  const write = spec.write ?? {};
  const capped = spec.capped ?? [];
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
  if (!Array.isArray(capped) || capped.some((name) => typeof name !== "string")) {
    throw new Error("toolRisk.capped must be an array of tool names");
  }
  for (const name of capped) {
    // Only a write can enforce its own cap; a capped read or unknown tool is a typo.
    if (!Object.prototype.hasOwnProperty.call(write, name)) {
      throw new Error(`Capped tool ${name} must also be declared in toolRisk.write`);
    }
  }
  return { read, write, capped };
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
 * @param {{ read?: string[], write?: Record<string, string>, capped?: string[] } | undefined} spec
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
 * Make every later `server.tool(...)` or `server.registerTool(...)` registration
 * carry its risk class. Mutates and returns the server. For `tool()`, fakes that
 * return nothing (test harnesses) are left alone; for `registerTool()` the risk
 * is merged into the config, over any annotations the tool set itself.
 *
 * @template T
 * @param {T} server an McpServer
 * @param {{ read?: string[], write?: Record<string, string>, capped?: string[] }} spec
 * @returns {T}
 */
function applyToolRisk(server, spec) {
  if (typeof server.tool === "function") {
    const register = server.tool.bind(server);
    server.tool = (...args) => {
      const registered = register(...args);
      const risk = riskFor(args[0], spec);
      if (risk && registered && typeof registered.update === "function") {
        registered.update(risk);
      }
      return registered;
    };
  }
  if (typeof server.registerTool === "function") {
    const registerTool = server.registerTool.bind(server);
    server.registerTool = (name, config, handler) => {
      const risk = riskFor(name, spec);
      if (!risk) return registerTool(name, config, handler);
      return registerTool(
        name,
        {
          ...config,
          annotations: { ...(config && config.annotations), ...risk.annotations },
          _meta: { ...(config && config._meta), ...risk._meta },
        },
        handler,
      );
    };
  }
  return server;
}

module.exports = {
  CATEGORY_META_KEY,
  CAP_ENFORCED_META_KEY,
  APPROVAL_ARG,
  WRITE_CATEGORIES,
  riskFor,
  applyToolRisk,
  normalizeToolRiskSpec,
  withToolRisk,
};

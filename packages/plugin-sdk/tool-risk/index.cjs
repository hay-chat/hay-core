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
 * @param {{ read: string[], write: Record<string, string>, capped?: string[] }} spec
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
  const _meta = { [CATEGORY_META_KEY]: category };
  if ((spec.capped || []).includes(name)) _meta[CAP_ENFORCED_META_KEY] = true;
  return {
    annotations: { readOnlyHint: false, destructiveHint: WRITE_CATEGORIES[category].destructive },
    _meta,
  };
}

/**
 * Make every later `server.tool(...)` or `server.registerTool(...)` registration
 * carry its risk class. Mutates and returns the server. For `tool()`, fakes that
 * return nothing (test harnesses) are left alone; for `registerTool()` the risk
 * is merged into the config, over any annotations the tool set itself.
 *
 * @template T
 * @param {T} server an McpServer
 * @param {{ read: string[], write: Record<string, string>, capped?: string[] }} spec
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
};

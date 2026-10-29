/**
 * The e-commerce plugins' tool names, read from their MCP sources so playbook placeholders can be
 * checked offline (tests and --dry-run). The server does the same check against the org's live tool
 * registry when a playbook is saved (playbooks.create/update return actionWarnings).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/data";
import type { Platform } from "../lib/types";

/** package.json "name" of each plugin (plugins/core/<platform>/package.json); the mention id prefix. */
export const PLUGIN_IDS: Record<Platform, string> = {
  shopify: "hay-plugin-shopify",
  woocommerce: "hay-plugin-woocommerce",
  nuvemshop: "hay-plugin-nuvemshop",
};

export const REPO_ROOT = join(ROOT, "..", "..");

const REGISTRATION = /(?:server\.tool|server\.registerTool)\(\s*"([a-z0-9_]+)"/g;

/** Tool names registered in plugins/core/<platform>/mcp/tools/*.js. */
export function listPluginTools(platform: Platform): string[] {
  const dir = join(REPO_ROOT, "plugins", "core", platform, "mcp", "tools");
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    for (const match of readFileSync(join(dir, file), "utf8").matchAll(REGISTRATION)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** Plugin id for a tool name, by its `<platform>_` prefix. Throws for a tool of no known plugin. */
export function pluginIdForTool(toolName: string): string {
  const platform = (Object.keys(PLUGIN_IDS) as Platform[]).find((p) =>
    toolName.startsWith(`${p}_`),
  );
  if (!platform)
    throw new Error(
      `{{action:${toolName}}} names no known plugin (expected a shopify_, woocommerce_ or nuvemshop_ tool)`,
    );
  return PLUGIN_IDS[platform];
}

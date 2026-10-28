/**
 * Hay Plugin SDK - typed bridge to the tool-risk helper.
 *
 * The rules live in `@hay/plugin-sdk/tool-risk` (plain CommonJS, so local MCP
 * servers spawned with `node` can require it). The worker loads the same file
 * through the package's own name, which resolves from source and from dist.
 *
 * @module @hay/plugin-sdk/sdk/tool-risk
 * @internal
 */

import { createRequire } from "module";
import type { ToolRiskSpec } from "../types/index.js";

interface ToolRiskHelper {
  normalizeToolRiskSpec(spec: ToolRiskSpec | undefined): Required<ToolRiskSpec>;
  withToolRisk<T extends { name: string }>(tools: T[], spec: ToolRiskSpec | undefined): T[];
}

const helper = createRequire(import.meta.url)("@hay/plugin-sdk/tool-risk") as ToolRiskHelper;

/** Throws when a declared category is unknown or the spec is malformed. */
export function validateToolRiskSpec(spec: ToolRiskSpec | undefined): void {
  helper.normalizeToolRiskSpec(spec);
}

/** Merge a plugin's declared risk into listed tools (declaration wins). */
export function withToolRisk<T extends { name: string }>(
  tools: T[],
  spec: ToolRiskSpec | undefined,
): T[] {
  return spec ? helper.withToolRisk(tools, spec) : tools;
}

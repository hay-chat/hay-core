/**
 * Every Jira tool must carry a risk class, or Hay.chat core treats it as an
 * unknown write and holds it for approval.
 */
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import plugin, { JIRA_TOOL_RISK } from "../index.js";

const { withToolRisk, CATEGORY_META_KEY } = createRequire(import.meta.url)(
  "@hay/plugin-sdk/tool-risk",
);

const silent = { info() {}, warn() {}, error() {}, debug() {} };

async function startedServer() {
  let registered: { initializer: any; options: any } | undefined;
  const definition = plugin({ logger: silent } as any);
  await definition.onStart!({
    org: { id: "org" },
    logger: silent,
    config: { getOptional: () => undefined },
    auth: { get: () => null },
    mcp: {
      startLocal: async (_id: string, initializer: any, options: any) => {
        registered = { initializer, options };
      },
    },
  } as any);
  const instance = await registered!.initializer({});
  return { tools: await instance.listTools(), options: registered!.options };
}

describe("Jira tool risk", () => {
  it("registers the declaration and classifies every listed tool", async () => {
    const { tools, options } = await startedServer();
    expect(options.toolRisk).toBe(JIRA_TOOL_RISK);

    const listed = withToolRisk(tools, options.toolRisk);
    const unclassified = listed
      .filter((t: any) => t.annotations?.readOnlyHint !== true && !t._meta?.[CATEGORY_META_KEY])
      .map((t: any) => t.name);
    expect(unclassified).toEqual([]);

    const names = tools.map((t: any) => t.name);
    const declared = [...JIRA_TOOL_RISK.read!, ...Object.keys(JIRA_TOOL_RISK.write!)];
    expect(declared.filter((name) => !names.includes(name))).toEqual([]);
  });
});

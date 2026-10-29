import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerTool,
  unregisterTool,
  provideContext,
  listPageTools,
  executePageTool,
  pageToolsVersion,
  resetPageTools,
} from "../usePageTools";

/**
 * Page tools (WebMCP): what the host page registers is what the server sees,
 * minus `execute`, which only ever runs here.
 */
describe("usePageTools", () => {
  beforeEach(() => {
    resetPageTools();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("lists descriptors without execute and fills the default schema", () => {
    registerTool({
      name: "open_cart",
      description: "  Open the cart drawer ",
      annotations: { readOnlyHint: true },
      execute: () => "opened",
    });
    registerTool({
      name: "add_to_cart",
      description: "Add a variant",
      inputSchema: { type: "object", properties: { variantId: { type: "string" } } },
      execute: () => ({ content: [{ type: "text", text: "Added" }] }),
    });
    expect(listPageTools()).toEqual([
      {
        name: "open_cart",
        description: "Open the cart drawer",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
      {
        name: "add_to_cart",
        description: "Add a variant",
        inputSchema: { type: "object", properties: { variantId: { type: "string" } } },
      },
    ]);
  });

  it("rejects tools without a valid name, description or execute", () => {
    registerTool({ name: "bad name", description: "x", execute: () => null });
    registerTool({ name: "ok", description: "", execute: () => null });
    registerTool({ name: "ok", description: "x" } as never);
    expect(listPageTools()).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(3);
  });

  it("runs the tool with the AI's arguments and bumps the version on changes", async () => {
    const before = pageToolsVersion.value;
    const execute = vi.fn(async (args: Record<string, unknown>) => `went to ${args.path}`);
    registerTool({ name: "navigate", description: "Go somewhere", execute });
    expect(pageToolsVersion.value).toBe(before + 1);

    await expect(executePageTool("navigate", { path: "/inbox" })).resolves.toBe("went to /inbox");
    expect(execute).toHaveBeenCalledWith({ path: "/inbox" });

    unregisterTool("navigate");
    expect(pageToolsVersion.value).toBe(before + 2);
    await expect(executePageTool("navigate", {})).rejects.toThrow("not registered");
  });

  it("provideContext replaces the WebMCP set but keeps HayChat registrations", () => {
    registerTool({ name: "hay_only", description: "x", execute: () => null });
    provideContext({ tools: [{ name: "a", description: "x", execute: () => null }] });
    provideContext({ tools: [{ name: "b", description: "x", execute: () => null }] });
    expect(listPageTools().map((t) => t.name)).toEqual(["hay_only", "b"]);
  });
});

import { describe, expect, it } from "@jest/globals";
import { pluginIsolationMode } from "@server/lib/plugin-isolation";

describe("plugin isolation setting", () => {
  it("is off unless explicitly configured", () => {
    expect(pluginIsolationMode({})).toBe("off");
    expect(pluginIsolationMode({ PLUGIN_ISOLATION: "  " })).toBe("off");
  });

  it("accepts strict and degraded", () => {
    expect(pluginIsolationMode({ PLUGIN_ISOLATION: "strict" })).toBe("strict");
    expect(pluginIsolationMode({ PLUGIN_ISOLATION: "Degraded" })).toBe("degraded");
  });

  it("refuses anything else rather than silently running unisolated", () => {
    expect(() => pluginIsolationMode({ PLUGIN_ISOLATION: "true" })).toThrow(/strict/);
  });
});

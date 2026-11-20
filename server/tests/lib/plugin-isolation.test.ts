import { describe, expect, it } from "@jest/globals";
import { ownPluginApiSocketPath, pluginIsolationMode } from "@server/lib/plugin-isolation";

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

  it("serves the plugin API on a socket of the core process's own, next to the configured one", () => {
    const env = { PLUGIN_API_SOCKET: "/run/hay/api/core.sock" };
    const own = ownPluginApiSocketPath(env);
    expect(own).toMatch(/^\/run\/hay\/api\/core-[0-9a-f]{12}\.sock$/);
    expect(ownPluginApiSocketPath(env)).toBe(own);
    expect(ownPluginApiSocketPath({})).toBeUndefined();
  });
});

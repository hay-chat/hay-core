import { beforeEach, describe, expect, it, vi } from "vitest";

const { callUiRoute, configure, completeWithCode } = vi.hoisted(() => ({
  callUiRoute: vi.fn(),
  configure: vi.fn(),
  completeWithCode: vi.fn(),
}));

vi.mock("@/utils/api", () => ({
  Hay: {
    plugins: {
      callUiRoute: { mutate: callUiRoute },
      configure: { mutate: configure },
      oauth: { completeWithCode: { mutate: completeWithCode } },
    },
  },
}));

import { createPluginUiApi } from "@/utils/plugin-ui-api";

/** Every callable path of the client, e.g. `plugins.callUiRoute.mutate`. */
function callablePaths(node: object, prefix = ""): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "function"
      ? [`${prefix}${key}`]
      : callablePaths(value as object, `${prefix}${key}.`),
  );
}

describe("createPluginUiApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes only the procedures plugin UIs use", () => {
    expect(callablePaths(createPluginUiApi("plugin-a")).sort()).toEqual([
      "emailDomains.create.mutate",
      "emailDomains.get.query",
      "emailDomains.remove.mutate",
      "emailDomains.verify.mutate",
      "plugins.callUiRoute.mutate",
      "plugins.configure.mutate",
      "plugins.oauth.completeWithCode.mutate",
    ]);
  });

  it("has nothing at an unlisted procedure path", () => {
    const api = createPluginUiApi("plugin-a") as unknown as Record<string, Record<string, unknown>>;

    expect(api.organizations).toBeUndefined();
    expect(api.plugins.getUiAssetUrls).toBeUndefined();
    expect((api.plugins.oauth as Record<string, unknown>).revoke).toBeUndefined();
  });

  it("binds every plugin call to its own plugin", async () => {
    const api = createPluginUiApi("plugin-a");

    await api.plugins.callUiRoute.mutate({ pluginId: "plugin-b", method: "GET", path: "/ui/x" });
    await api.plugins.configure.mutate({ pluginId: "plugin-b", configuration: { a: 1 } });
    await api.plugins.oauth.completeWithCode.mutate({ pluginId: "plugin-b", code: "c" });

    expect(callUiRoute).toHaveBeenCalledWith({
      pluginId: "plugin-a",
      method: "GET",
      path: "/ui/x",
    });
    expect(configure).toHaveBeenCalledWith({ pluginId: "plugin-a", configuration: { a: 1 } });
    expect(completeWithCode).toHaveBeenCalledWith({ pluginId: "plugin-a", code: "c" });
  });

  it("can be turned into a string without calling anything", () => {
    expect(String(createPluginUiApi("plugin-a"))).toBe("[object Object]");
  });
});

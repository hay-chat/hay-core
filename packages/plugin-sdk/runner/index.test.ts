import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./bootstrap.js", () => ({
  parseArgs: () => ({ pluginPath: "/plugin", orgId: "org-1", port: 0, mode: "production" }),
  loadManifest: () => ({ manifest: { displayName: "Test" }, entryPath: "/plugin/index.js" }),
}));
vi.mock("./plugin-loader.js", () => ({ loadPlugin: async () => ({ name: "test" }) }));
vi.mock("./global-context.js", () => ({ createGlobalContext: () => ({}) }));
vi.mock("./hook-executor.js", () => ({
  executeOnInitialize: async () => undefined,
  executeOnStart: async () => true,
  executeOnDisable: async () => undefined,
}));
vi.mock("./loopback-bridge.js", () => ({ startSandboxBridges: async () => undefined }));
vi.mock("./http-server.js", () => ({
  PluginHttpServer: class {
    setPlugin() {}
    async start() {}
    async stop() {}
    setCredentialStore() {}
    setRuntimeData() {}
    registerMcpServer() {}
  },
}));
const { loadOrgData } = vi.hoisted(() => ({ loadOrgData: vi.fn() }));
vi.mock("./org-context.js", () => ({
  loadOrgData,
  createMockOrgData: () => ({}),
  createStartContext: () => ({ mcp: {} }),
  createDisableContext: () => ({}),
}));

import { main } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HAY_WORKER_SECRET;
});

describe("runner startup", () => {
  it("exits non-zero when the organization's runtime data cannot be loaded, so core starts it again", async () => {
    process.env.HAY_WORKER_SECRET = "secret";
    loadOrgData.mockRejectedValue(new Error("core unreachable"));
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);

    await expect(main()).rejects.toThrow("exit 2");

    expect(exit).toHaveBeenCalledWith(2);
  });
});

import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const upsertPlugin = jest.fn(async (input: Record<string, unknown>) => input);

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { upsertPlugin },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("../../services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({}),
}));

import { pluginManagerService } from "../../services/plugin-manager.service";
import { readSetupHints } from "../../services/setup/plugin-hints";

async function register(hayPlugin: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "hay-plugin-"));
  try {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "hay-test-shop", version: "1.0.0", "hay-plugin": hayPlugin }),
    );
    await pluginManagerService.registerPlugin(dir, "core", null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return upsertPlugin.mock.calls[upsertPlugin.mock.calls.length - 1][0] as {
    manifest: { setup?: unknown };
  };
}

describe("manifest setup hints", () => {
  beforeEach(() => upsertPlugin.mockClear());

  it("survives the manifest builder", async () => {
    const saved = await register({
      displayName: "Test Shop",
      category: "mcp-connector",
      setup: { businessTypes: ["store"], group: "commerce", handles: ["orders", "refunds"] },
    });
    expect(saved.manifest.setup).toEqual({
      businessTypes: ["store"],
      group: "commerce",
      handles: ["orders", "refunds"],
    });
  });

  it("leaves setup out when the plugin declares none", async () => {
    const saved = await register({ displayName: "Plain", category: "mcp-connector" });
    expect(saved.manifest.setup).toBeUndefined();
  });
});

describe("readSetupHints", () => {
  it("drops unknown values and rejects a block without a known group", () => {
    expect(
      readSetupHints({ group: "crm", businessTypes: ["saas", "nope"], handles: ["x", "billing"] }),
    ).toEqual({ group: "crm", businessTypes: ["saas"], handles: ["billing"] });
    expect(readSetupHints({ group: "nope", businessTypes: ["store"] })).toBeUndefined();
    expect(readSetupHints("store")).toBeUndefined();
  });
});

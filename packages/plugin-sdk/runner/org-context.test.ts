import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOrgData } from "./org-context.js";
import { createLogger } from "../sdk/logger.js";
import type { HayPluginManifest } from "../types/index.js";

const logger = createLogger();
const manifest = (credentials: unknown[] = []) =>
  ({ capabilities: ["mcp", "credentials"], credentials }) as unknown as HayPluginManifest;

describe("loadOrgData", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });

  it("needs the settings and no longer reads the old whole-config variables", async () => {
    process.env.HAY_ORG_CONFIG = JSON.stringify({ org: { id: "o" }, config: { secret: "x" } });
    process.env.HAY_ORG_AUTH = JSON.stringify({ methodId: "m", credentials: { a: "b" } });
    delete process.env.HAY_ORG_SETTINGS;
    await expect(loadOrgData(manifest(), logger)).rejects.toThrow(/HAY_ORG_SETTINGS/);
  });

  it("builds the org from the settings and pulls what the manifest declares", async () => {
    process.env.HAY_ORG_SETTINGS = JSON.stringify({
      org: { id: "org-1" },
      config: { region: "eu" },
      authMethodId: "apiKey",
    });
    process.env.HAY_API_URL = "http://core.test";
    process.env.HAY_API_TOKEN = "t";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: { data: { value: { k: "v" } } } }))),
    );

    const { orgData } = await loadOrgData(
      manifest([{ name: "auth", source: "auth", capability: "mcp" }]),
      logger,
    );

    expect(orgData.org.id).toBe("org-1");
    expect(orgData.config).toMatchObject({ region: "eu", k: "v" });
    expect(orgData.auth).toEqual({ methodId: "apiKey", credentials: { k: "v" } });
  });

  it("refuses to start pulling without a token", async () => {
    process.env.HAY_ORG_SETTINGS = JSON.stringify({ org: { id: "o" }, config: {} });
    delete process.env.HAY_API_TOKEN;
    await expect(
      loadOrgData(manifest([{ name: "apiKey", source: "config", capability: "mcp" }]), logger),
    ).rejects.toThrow(/HAY_API_TOKEN/);
  });
});

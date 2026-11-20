import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGlobalContext } from "./global-context.js";
import { PluginRegistry } from "../sdk/registry.js";
import { createLogger } from "../sdk/logger.js";
import type { HayPluginManifest } from "../types/index.js";

const manifest = (capabilities: string[]) =>
  ({ capabilities, env: [] }) as unknown as HayPluginManifest;

describe("createGlobalContext state", () => {
  beforeEach(() => {
    process.env.HAY_API_URL = "http://core.invalid";
    process.env.HAY_API_TOKEN = "token";
  });
  afterEach(() => {
    delete process.env.HAY_API_URL;
    delete process.env.HAY_API_TOKEN;
  });

  it("gives state only to a plugin that declares the state capability", () => {
    const create = (capabilities: string[]) =>
      createGlobalContext(createLogger(), new PluginRegistry(), manifest(capabilities));
    expect(create(["state"]).state).toBeDefined();
    expect(create(["mcp", "auth"]).state).toBeUndefined();
  });
});

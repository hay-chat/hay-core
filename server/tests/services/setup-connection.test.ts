import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/services/plugin-manager.service", () => ({ pluginManagerService: {} }));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/services/plugin-tools.service", () => ({ getCachedToolDescriptors: () => [] }));
jest.mock("@server/services/plugin-setup-status.service", () => ({
  readPluginSetupStatus: async () => null,
}));

import {
  resolveConnections,
  resolveOne,
  type ConnectionDeps,
  type PluginFacts,
} from "../../services/setup/connection";

const facts = (over: Partial<PluginFacts> = {}): PluginFacts => ({
  enabled: true,
  hasStatusHandler: false,
  usesOAuth: true,
  oauthConnected: true,
  toolCount: 5,
  requiredConfigPresent: true,
  ...over,
});
const deps = (over: Partial<ConnectionDeps> & { byId?: Record<string, PluginFacts | null> } = {}) =>
  ({
    timeoutMs: 50,
    facts: async (id: string) => (over.byId ? (over.byId[id] ?? null) : facts()),
    setupStatus: async () => null,
    ...over,
  }) as ConnectionDeps;

describe("resolveOne", () => {
  it("a channel registers no tools, but still has to finish connecting", async () => {
    const channel = { needsTools: false };
    const check = (over: Partial<PluginFacts>) =>
      resolveOne("p", deps({ byId: { p: facts({ toolCount: 0, ...over }) } }), channel);

    expect(await check({})).toBe("connected");
    expect(await check({ oauthConnected: false })).toBe("not_connected");
    expect(await check({ usesOAuth: false, requiredConfigPresent: false })).toBe("not_connected");
    expect(await check({ usesOAuth: false })).toBe("connected");
    expect(await check({ enabled: false })).toBe("not_connected");
    // Without the option, tools still count.
    expect(await resolveOne("p", deps({ byId: { p: facts({ toolCount: 0 }) } }))).toBe(
      "not_connected",
    );
  });

  it("a plugin that is only enabled is not connected", async () => {
    expect(await resolveOne("p", deps({ byId: { p: facts({ oauthConnected: false }) } }))).toBe(
      "not_connected",
    );
    expect(await resolveOne("p", deps({ byId: { p: facts({ enabled: false }) } }))).toBe(
      "not_connected",
    );
    expect(await resolveOne("p", deps({ byId: {} }))).toBe("not_connected");
  });

  it("OAuth needs both the token and tools", async () => {
    expect(await resolveOne("p", deps())).toBe("connected");
    expect(await resolveOne("p", deps({ byId: { p: facts({ toolCount: 0 }) } }))).toBe(
      "not_connected",
    );
  });

  it("the plugin's own status wins when it answers", async () => {
    const handler = facts({ hasStatusHandler: true, oauthConnected: false, toolCount: 0 });
    expect(
      await resolveOne(
        "p",
        deps({ byId: { p: handler }, setupStatus: async () => ({ state: "connected" }) }),
      ),
    ).toBe("connected");
    expect(
      await resolveOne(
        "p",
        deps({
          byId: { p: facts({ hasStatusHandler: true }) },
          setupStatus: async () => ({ state: "error" }),
        }),
      ),
    ).toBe("not_connected");
  });

  it("falls back to oauth and tools when the plugin does not answer", async () => {
    const withHandler = facts({ hasStatusHandler: true });
    expect(
      await resolveOne("p", deps({ byId: { p: withHandler }, setupStatus: async () => null })),
    ).toBe("connected");
  });

  it("key-based plugins need their settings and tools", async () => {
    const keyed = facts({ usesOAuth: false, oauthConnected: false });
    expect(await resolveOne("p", deps({ byId: { p: keyed } }))).toBe("connected");
    expect(
      await resolveOne("p", deps({ byId: { p: { ...keyed, requiredConfigPresent: false } } })),
    ).toBe("not_connected");
  });
});

describe("resolveConnections", () => {
  it("a timed-out or rejected plugin is unknown and never stalls or fails the rest", async () => {
    const started = Date.now();
    const states = await resolveConnections(
      ["fast", "slow", "broken"],
      deps({
        facts: async (id: string) => {
          if (id === "slow") return new Promise<PluginFacts>(() => undefined);
          if (id === "broken") throw new Error("db down");
          return facts();
        },
      }),
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(Object.fromEntries(states)).toEqual({
      fast: "connected",
      slow: "unknown",
      broken: "unknown",
    });
  });

  it("asks each plugin once", async () => {
    const calls: string[] = [];
    await resolveConnections(
      ["a", "a", "b"],
      deps({ facts: async (id: string) => (calls.push(id), facts()) }),
    );
    expect(calls.sort()).toEqual(["a", "b"]);
  });
});

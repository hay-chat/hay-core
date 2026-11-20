import { describe, expect, it, vi } from "vitest";
import { CredentialStore, type CredentialDeclaration } from "./credential-store.js";
import { createAuthRuntimeAPI } from "./auth-runtime.js";
import { createConfigRuntimeAPI } from "./config-runtime.js";
import { PluginRegistry } from "./registry.js";
import { createLogger } from "./logger.js";

const logger = createLogger();

const declarations: CredentialDeclaration[] = [
  { name: "apiKey", source: "config", capability: "mcp" },
  { name: "auth", source: "auth", capability: "mcp" },
];

/** A fake core: answers `credentials.get` from `answers`, counting the pulls. */
function fakeCore(answers: Record<string, unknown>) {
  const pulls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("http://core.test/v1/pluginApi.credentials.get");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer worker-token");
    const { name } = JSON.parse(String(init.body));
    pulls.push(name);
    if (!(name in answers)) return new Response("{}", { status: 403 });
    const value = answers[name];
    const expiresAt =
      name === "auth" ? ((value as { expiresAt?: number }).expiresAt ?? null) : null;
    return new Response(JSON.stringify({ result: { data: { value, expiresAt } } }));
  }) as unknown as typeof fetch;
  return { fetchImpl, pulls };
}

const store = (core: ReturnType<typeof fakeCore>, now = () => 1_000_000_000_000) =>
  new CredentialStore({
    declarations,
    settings: { shopDomain: "a.example" },
    authMethodId: "oauth",
    apiUrl: "http://core.test/",
    apiToken: "worker-token",
    logger,
    fetchImpl: core.fetchImpl,
    now,
  });

describe("CredentialStore", () => {
  it("fills the config map and auth state that ctx.config and ctx.auth read", async () => {
    const core = fakeCore({
      apiKey: "key-1",
      auth: { accessToken: "token-1", expiresAt: 2_000_000_000 },
    });
    const credentials = store(core);
    const config = createConfigRuntimeAPI({
      orgConfig: credentials.config,
      registry: new PluginRegistry(),
      logger,
    });
    const auth = createAuthRuntimeAPI({ authState: credentials.authState, logger });

    await credentials.refreshAll();

    expect(config.getOptional("shopDomain")).toBe("a.example");
    expect(config.getOptional("apiKey")).toBe("key-1");
    expect(config.getOptional("accessToken")).toBe("token-1");
    expect(auth.get()).toEqual({
      methodId: "oauth",
      credentials: { accessToken: "token-1", expiresAt: 2_000_000_000 },
    });
  });

  it("holds nothing before it has pulled, and fails when core refuses", async () => {
    const credentials = store(fakeCore({ apiKey: "k" }));
    expect(credentials.config).toEqual({ shopDomain: "a.example" });
    await expect(credentials.refreshAll()).rejects.toThrow(/refused credential "auth" \(403\)/);
  });

  it("pulls again before the access token expires, and keeps it fresh in place", async () => {
    let clock = 1_000_000_000_000;
    const answers: Record<string, unknown> = {
      apiKey: "key-1",
      auth: { accessToken: "token-1", expiresAt: 1_000_000_600 },
    };
    const core = fakeCore(answers);
    const credentials = store(core, () => clock);
    await credentials.refreshAll();
    core.pulls.length = 0;

    await credentials.refreshStale();
    expect(core.pulls).toEqual([]);

    // Core refreshes the token on the next pull.
    answers.auth = { accessToken: "token-2", expiresAt: 1_000_004_200 };
    clock += 500 * 1000; // 100 s before expiry, inside the 120 s margin
    await credentials.refreshStale();

    expect(core.pulls).toContain("auth");
    expect(credentials.authState?.credentials.accessToken).toBe("token-2");
    expect(credentials.config.accessToken).toBe("token-2");
  });

  it("keeps working with what it holds when a refresh fails", async () => {
    let clock = 1_000_000_000_000;
    const answers: Record<string, unknown> = { apiKey: "k", auth: { accessToken: "t" } };
    const credentials = store(fakeCore(answers), () => clock);
    await credentials.refreshAll();
    delete answers.apiKey;
    clock += 61_000;

    await credentials.refreshStale();

    expect(credentials.config.apiKey).toBe("k");
  });

  it("has no auth state when the organization has no connected account", async () => {
    const credentials = new CredentialStore({
      declarations: [{ name: "apiKey", source: "config", capability: "mcp" }],
      settings: {},
      authMethodId: null,
      apiUrl: "http://core.test",
      apiToken: "worker-token",
      logger,
      fetchImpl: fakeCore({ apiKey: "k" }).fetchImpl,
    });
    await credentials.refreshAll();
    expect(credentials.authState).toBeNull();
  });
});

describe("CredentialStore concurrent and failing pulls", () => {
  it("shares one pull between requests that arrive while a refresh is running", async () => {
    const core = fakeCore({ apiKey: "key-1", auth: { accessToken: "t", expiresAt: 2_000_000_000 } });
    const credentials = store(core);

    await Promise.all([
      credentials.refreshStale(),
      credentials.refreshStale(),
      credentials.refreshStale(),
    ]);

    expect(core.pulls.sort()).toEqual(["apiKey", "auth"]);
  });

  it("gives every pull a time limit", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal);
      return new Response(JSON.stringify({ result: { data: { value: "v", expiresAt: null } } }));
    }) as unknown as typeof fetch;
    const credentials = new CredentialStore({
      declarations: [{ name: "apiKey", source: "config", capability: "mcp" }],
      settings: {},
      authMethodId: null,
      apiUrl: "http://core.test",
      apiToken: "worker-token",
      logger,
      fetchImpl,
    });

    await credentials.refreshAll();

    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("clears the connected account's credentials when core reports the account gone", async () => {
    let answer: unknown = { accessToken: "token-1", expiresAt: null };
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { data: { value: answer, expiresAt: null } } })),
    ) as unknown as typeof fetch;
    const credentials = new CredentialStore({
      declarations: [{ name: "auth", source: "auth", capability: "mcp" }],
      settings: {},
      authMethodId: "oauth",
      apiUrl: "http://core.test",
      apiToken: "worker-token",
      logger,
      fetchImpl,
    });
    await credentials.refreshAll();
    expect(credentials.authState?.credentials).toEqual({ accessToken: "token-1", expiresAt: null });

    answer = null;
    await credentials.refreshAll();

    expect(credentials.authState?.credentials).toEqual({});
    expect(credentials.config).not.toHaveProperty("accessToken");
  });
});

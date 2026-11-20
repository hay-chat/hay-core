/**
 * A worker pulls only the credentials its manifest declares, only with the
 * capability the manifest binds them to, only for its own organization and
 * plugin; core refreshes an expiring access token on the pull, never returns a
 * refresh token, and audits every issue without the value.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/lib/auth/utils/encryption", () => ({
  decryptConfig: (config: Record<string, unknown>) => config,
}));

const NOW = Math.floor(Date.now() / 1000);

type Instance = {
  enabled: boolean;
  authMethod?: string;
  config: Record<string, unknown>;
  authState?: { methodId: string; credentials: Record<string, unknown> };
};
const instances = new Map<string, Instance>();
const findByOrgAndPlugin = jest.fn(
  async (org: string, plugin: string) => instances.get(`${org}:${plugin}`) ?? null,
);
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin },
}));

const plugin = {
  sourceType: "core",
  manifest: {
    permissions: { env: ["TEST_MANAGED_KEY"] },
    credentials: [
      { name: "apiKey", source: "config", capability: "mcp", hosts: [] },
      { name: "managedKey", source: "config", capability: "mcp", hosts: [] },
      { name: "clientSecret", source: "config", capability: "mcp", hosts: [] },
      { name: "sharedKey", source: "config", capability: "mcp", hosts: [], allowEnv: false },
      { name: "publicField", source: "config", capability: "mcp", hosts: [] },
      { name: "turnstileKey", source: "config", capability: "webchat", hosts: [] },
      { name: "auth", source: "auth", capability: "mcp", hosts: [] },
    ],
  },
  metadata: {
    configSchema: {
      apiKey: { type: "string", label: "k", encrypted: true },
      managedKey: { type: "string", label: "m", encrypted: true, env: "TEST_MANAGED_KEY" },
      clientSecret: { type: "string", label: "s", encrypted: true, serverOnly: true },
      publicField: { type: "string", label: "p" },
      turnstileKey: { type: "string", label: "t", encrypted: true },
      sharedKey: { type: "string", label: "sk", encrypted: true, env: "TEST_MANAGED_KEY" },
    },
  },
};
const findByPluginId = jest.fn(async (id: string) => (id === "p" ? plugin : null));
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId },
}));

const record = jest.fn(async (_entry: unknown) => undefined);
jest.mock("@server/services/audit-log.service", () => ({ auditLogService: { record } }));
const refreshToken = jest.fn(async (org: string, id: string, _options?: object) => {
  const instance = instances.get(`${org}:${id}`)!;
  instance.authState!.credentials = {
    accessToken: "new-token",
    refreshToken: "new-refresh",
    expiresAt: NOW + 3600,
  };
  return null;
});
jest.mock("@server/services/oauth.service", () => ({ oauthService: { refreshToken } }));

let issueCredential: typeof import("@server/services/plugin-credential.service").issueCredential;

const ask = (name: string, capabilities = ["mcp", "credentials"], org = "org-a", id = "p") =>
  issueCredential({ organizationId: org, pluginId: id, capabilities, name });

beforeEach(async () => {
  // The service remembers failed refreshes and audited values; start each test clean.
  jest.resetModules();
  ({ issueCredential } = await import("@server/services/plugin-credential.service"));
  jest.clearAllMocks();
  instances.clear();
  instances.set("org-a:p", {
    enabled: true,
    authMethod: "oauth",
    config: { apiKey: "key-a", publicField: "x", clientSecret: "cs", turnstileKey: "tk" },
    authState: {
      methodId: "oauth",
      credentials: {
        accessToken: "token-a",
        refreshToken: "refresh-a",
        clientSecret: "cs",
        expiresAt: NOW + 3600,
      },
    },
  });
  instances.set("org-b:p", {
    enabled: true,
    config: { apiKey: "key-b" },
  });
  delete process.env.TEST_MANAGED_KEY;
});

describe("issueCredential", () => {
  it("returns a declared secret config field", async () => {
    await expect(ask("apiKey")).resolves.toEqual({ value: "key-a", expiresAt: null });
  });

  it("refuses a worker whose token lacks the capability the credential is bound to", async () => {
    await expect(ask("apiKey", ["messages", "credentials"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(ask("turnstileKey", ["mcp", "credentials"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(ask("auth", [])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(record).not.toHaveBeenCalled();
  });

  it.each(["undeclared", "refreshToken", "../auth"])(
    "refuses the undeclared name %s",
    async (name) => {
      await expect(ask(name)).rejects.toMatchObject({ code: "NOT_FOUND" });
    },
  );

  it("refuses a field that is not a secret, or never leaves core", async () => {
    await expect(ask("publicField")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ask("clientSecret")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("answers from the token's own organization and plugin only", async () => {
    await expect(ask("apiKey", ["mcp"], "org-b")).resolves.toMatchObject({ value: "key-b" });
    await expect(ask("apiKey", ["mcp"], "org-c")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another plugin's declarations are not this plugin's.
    await expect(ask("apiKey", ["mcp"], "org-a", "other")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses a plugin that is not enabled for the organization", async () => {
    instances.get("org-b:p")!.enabled = false;
    await expect(ask("apiKey", ["mcp"], "org-b")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("serves a declared secret before the plugin's field list has been cached", async () => {
    findByPluginId.mockResolvedValueOnce({ ...plugin, metadata: null } as unknown as typeof plugin);
    await expect(ask("apiKey")).resolves.toMatchObject({ value: "key-a" });
  });

  it("resolves a server-managed secret from the allowed env var", async () => {
    process.env.TEST_MANAGED_KEY = "managed-value";
    await expect(ask("managedKey")).resolves.toEqual({ value: "managed-value", expiresAt: null });
  });

  it("returns the connected account's credentials without the refresh token or server-only keys", async () => {
    const issued = await ask("auth");

    expect(issued.value).toEqual({ accessToken: "token-a", expiresAt: NOW + 3600 });
    expect(JSON.stringify(issued)).not.toContain("refresh");
    expect(issued.expiresAt).toBe(NOW + 3600);
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it("does not hand over an undeclared secret field stored with the account's credentials", async () => {
    instances.get("org-a:p")!.authState!.credentials.apiKey = "stored-undeclared";
    const declared = plugin.manifest.credentials;
    plugin.manifest.credentials = declared.filter((c) => c.name !== "apiKey");
    try {
      const issued = await ask("auth");
      expect(JSON.stringify(issued)).not.toContain("stored-undeclared");
    } finally {
      plugin.manifest.credentials = declared;
    }
  });

  it("refreshes an expiring access token when it is pulled, and still withholds the refresh token", async () => {
    instances.get("org-a:p")!.authState!.credentials.expiresAt = NOW + 30;

    const issued = await ask("auth");

    expect(refreshToken).toHaveBeenCalledWith("org-a", "p", { onlyIfExpiringWithinSeconds: 300 });
    expect(issued.value).toEqual({ accessToken: "new-token", expiresAt: NOW + 3600 });
    expect(JSON.stringify(issued)).not.toContain("new-refresh");
  });

  it("hands out the stored token when the refresh fails", async () => {
    instances.get("org-a:p")!.authState!.credentials.expiresAt = NOW + 30;
    refreshToken.mockRejectedValueOnce(new Error("provider down"));

    await expect(ask("auth")).resolves.toMatchObject({ value: { accessToken: "token-a" } });
  });

  it("tells the worker when an expiring token could not be refreshed, and does not ask the provider again right away", async () => {
    instances.get("org-a:p")!.authState!.credentials.expiresAt = NOW + 30;
    refreshToken.mockRejectedValueOnce(new Error("provider down"));

    await expect(ask("auth")).resolves.toMatchObject({
      value: { accessToken: "token-a" },
      refreshFailed: true,
    });
    await expect(ask("auth")).resolves.toMatchObject({ refreshFailed: true });

    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it("does not flag a credential whose refresh succeeded", async () => {
    instances.get("org-a:p")!.authState!.credentials.expiresAt = NOW + 30;

    expect(await ask("auth")).not.toHaveProperty("refreshFailed");
  });

  it("does not hand out the server-wide env value of a credential that opts out of it", async () => {
    process.env.TEST_MANAGED_KEY = "platform-secret";
    await expect(ask("sharedKey")).resolves.toEqual({ value: null, expiresAt: null });

    instances.get("org-a:p")!.config.sharedKey = "own-secret";
    await expect(ask("sharedKey")).resolves.toEqual({ value: "own-secret", expiresAt: null });
  });

  it("audits an issue again only when the value or expiry changed", async () => {
    await ask("apiKey");
    await ask("apiKey");
    expect(record).toHaveBeenCalledTimes(1);

    instances.get("org-a:p")!.config.apiKey = "key-rotated";
    await ask("apiKey");
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("audits each issue by name and capability, never the value", async () => {
    await ask("apiKey");
    await ask("auth");

    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "plugin",
        organizationId: "org-a",
        action: "plugin.credential.issue",
        changes: expect.objectContaining({
          pluginId: "p",
          credential: "apiKey",
          capability: "mcp",
        }),
      }),
    );
    const logged = JSON.stringify(record.mock.calls);
    for (const secret of ["key-a", "token-a", "refresh-a", "cs"]) {
      expect(logged).not.toContain(`"${secret}"`);
    }
  });
});

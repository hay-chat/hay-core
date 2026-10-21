import { TRPCError } from "@trpc/server";

const findByPluginId = jest.fn();
const findByOrgAndPlugin = jest.fn();
const clearAuthState = jest.fn();
const updateAuthState = jest.fn();
const upsertInstance = jest.fn();
const clearForInstance = jest.fn();
const upsertRoutes = jest.fn();
const stopPluginWorker = jest.fn();
const startPluginWorker = jest.fn();
const retrieveState = jest.fn();
const resolveConfigWithEnv = jest.fn();

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin, clearAuthState, updateAuthState, upsertInstance },
}));
jest.mock("@server/repositories/plugin-webhook-route.repository", () => ({
  pluginWebhookRouteRepository: { clearForInstance, upsertRoutes },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { stopPluginWorker, startPluginWorker },
}));
jest.mock("@server/services/oauth-state.service", () => ({
  oauthStateService: { retrieveState },
}));
jest.mock("@server/lib/config-resolver", () => ({
  resolveConfigWithEnv,
  stripServerOnlyFields: (config: Record<string, unknown>) => config,
}));

import { oauthService } from "../../services/oauth.service";

const TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token";

function registryPlugin(oauth2Extra: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    pluginId: "p",
    metadata: {
      configSchema: {},
      authMethods: [
        {
          id: "p-oauth",
          type: "oauth2",
          label: "Connect",
          authorizationUrl: "https://example.com/authorize",
          tokenUrl: TOKEN_URL,
          clientId: "clientId",
          clientSecret: "clientSecret",
          scopes: ["s1"],
          ...oauth2Extra,
        },
      ],
    },
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function instance(overrides: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    organizationId: "org-1",
    config: {},
    authState: { methodId: "p-oauth", credentials: { accessToken: "stored-token" } },
    ...overrides,
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  resolveConfigWithEnv.mockReturnValue({
    values: {},
    metadata: { clientId: { value: "app-id" }, clientSecret: { value: "app-secret" } },
  });
  findByPluginId.mockResolvedValue(registryPlugin());
  findByOrgAndPlugin.mockResolvedValue(instance());
  updateAuthState.mockResolvedValue(undefined);
  upsertInstance.mockResolvedValue(undefined);
  clearForInstance.mockResolvedValue(undefined);
  upsertRoutes.mockResolvedValue(undefined);
  startPluginWorker.mockResolvedValue({ port: 4321 });
});

describe("oauthService.completeWithCode", () => {
  it("exchanges the code via GET without redirect_uri and runs onConnected with extras", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "biz-token", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ routingKeys: ["WABA1", "PN1"] }));

    const result = await oauthService.completeWithCode("org-1", "p", "the-code", {
      waba_id: "WABA1",
      phone_number_id: "PN1",
    });

    // 1st call: the code exchange
    const [exchangeUrl, exchangeInit] = fetchMock.mock.calls[0];
    const url = new URL(exchangeUrl as string);
    expect(exchangeInit).toEqual({ method: "GET" });
    expect(url.origin + url.pathname).toBe(TOKEN_URL);
    expect(url.searchParams.get("client_id")).toBe("app-id");
    expect(url.searchParams.get("client_secret")).toBe("app-secret");
    expect(url.searchParams.get("code")).toBe("the-code");
    expect(url.searchParams.has("redirect_uri")).toBe(false);
    expect(url.searchParams.has("grant_type")).toBe(false);

    // Tokens stored on the existing instance
    expect(updateAuthState).toHaveBeenCalledWith(
      "inst-1",
      "org-1",
      expect.objectContaining({
        methodId: "p-oauth",
        credentials: expect.objectContaining({
          accessToken: "biz-token",
          tokenType: "bearer",
          expiresAt: undefined,
        }),
      }),
    );
    expect(upsertInstance).not.toHaveBeenCalled();

    // 2nd call: the worker hook with extras
    const [hookUrl, hookInit] = fetchMock.mock.calls[1];
    expect(hookUrl).toBe("http://localhost:4321/on-connected");
    const body = JSON.parse((hookInit as { body: string }).body);
    expect(body.extras).toEqual({ waba_id: "WABA1", phone_number_id: "PN1" });
    expect(body.authState).toBeDefined();

    expect(clearForInstance).toHaveBeenCalledWith("inst-1");
    expect(upsertRoutes).toHaveBeenCalledWith("p", "org-1", "inst-1", ["WABA1", "PN1"]);
    expect(result).toEqual({ success: true, onConnected: { ok: true, routingKeyCount: 2 } });
  });

  it("returns onConnected.ok=false when the worker hook fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "biz-token" }))
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, false, 500));

    const result = await oauthService.completeWithCode("org-1", "p", "the-code");

    expect(updateAuthState).toHaveBeenCalled();
    expect(upsertRoutes).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, onConnected: { ok: false, routingKeyCount: 0 } });
  });

  it("throws NOT_FOUND when the instance is missing", async () => {
    findByOrgAndPlugin.mockResolvedValue(null);

    await expect(oauthService.completeWithCode("org-1", "p", "the-code")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws BAD_REQUEST and stores nothing when the exchange fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "bad code" } }, false, 400));

    const promise = oauthService.completeWithCode("org-1", "p", "the-code");
    await expect(promise).rejects.toBeInstanceOf(TRPCError);
    await expect(promise).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "OAuth code exchange failed",
    });

    expect(updateAuthState).not.toHaveBeenCalled();
    expect(upsertInstance).not.toHaveBeenCalled();
    expect(startPluginWorker).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("oauthService.handleCallback", () => {
  it("runs the tokenExchange op when configured", async () => {
    findByPluginId.mockResolvedValue(
      registryPlugin({
        tokenExchange: {
          url: "https://graph.instagram.com/access_token",
          grantType: "ig_exchange_token",
          tokenParam: "access_token",
          includeClientSecret: true,
        },
      }),
    );
    retrieveState.mockResolvedValue({
      pluginId: "p",
      organizationId: "org-1",
      userId: "u-1",
      nonce: "nonce",
      codeVerifier: "verifier",
      createdAt: Date.now(),
    });
    fetchMock
      // authorization_code grant (POST form)
      .mockResolvedValueOnce(jsonResponse({ access_token: "short-lived", token_type: "bearer" }))
      // tokenExchange transform (GET)
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "long-lived", expires_in: 5184000, token_type: "bearer" }),
      )
      // worker /on-connected
      .mockResolvedValueOnce(jsonResponse({ routingKeys: [] }));

    const result = await oauthService.handleCallback("auth-code", "nonce");

    expect(result).toMatchObject({ success: true, pluginId: "p", organizationId: "org-1" });

    const exchangeUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(exchangeUrl.origin + exchangeUrl.pathname).toBe(
      "https://graph.instagram.com/access_token",
    );
    expect(exchangeUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(exchangeUrl.searchParams.get("access_token")).toBe("short-lived");
    expect(exchangeUrl.searchParams.get("client_secret")).toBe("app-secret");

    expect(updateAuthState).toHaveBeenCalledWith(
      "inst-1",
      "org-1",
      expect.objectContaining({
        credentials: expect.objectContaining({
          accessToken: "long-lived",
          expiresAt: expect.any(Number),
        }),
      }),
    );
  });
});

describe("oauthService onConnected credentials", () => {
  it("merges sanitized credentials and account into authState in one write", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "biz-token" }))
      .mockResolvedValueOnce(
        jsonResponse({
          routingKeys: [],
          account: { label: "+1 555 0100" },
          credentials: {
            wabaId: "WABA1",
            registrationPin: "123456",
            accessToken: "evil",
            refreshToken: "evil",
            expiresAt: "evil",
            connectedAt: "evil",
            tokenType: "evil",
            scope: "evil",
            numeric: 42,
            "bad-key": "x",
            tooLong: "x".repeat(4097),
          },
        }),
      );

    await oauthService.completeWithCode("org-1", "p", "the-code");

    // Call 1 stores tokens; call 2 is the onConnected merge.
    expect(updateAuthState).toHaveBeenCalledTimes(2);
    expect(updateAuthState).toHaveBeenLastCalledWith("inst-1", "org-1", {
      methodId: "p-oauth",
      account: { label: "+1 555 0100", avatarUrl: undefined },
      credentials: { accessToken: "stored-token", wabaId: "WABA1", registrationPin: "123456" },
    });
  });

  it("caps credentials at 20 keys", async () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, "v"]));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "biz-token" }))
      .mockResolvedValueOnce(jsonResponse({ credentials: many }));

    await oauthService.completeWithCode("org-1", "p", "the-code");

    const stored = updateAuthState.mock.calls[1][2].credentials as Record<string, string>;
    expect(Object.keys(stored)).toHaveLength(21); // 20 plugin keys + stored accessToken
  });

  it("still persists account-only results", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "biz-token" }))
      .mockResolvedValueOnce(jsonResponse({ account: { label: "@hay" } }));

    await oauthService.completeWithCode("org-1", "p", "the-code");

    expect(updateAuthState).toHaveBeenLastCalledWith("inst-1", "org-1", {
      methodId: "p-oauth",
      account: { label: "@hay", avatarUrl: undefined },
      credentials: { accessToken: "stored-token" },
    });
  });

  it("does not write authState when neither account nor valid credentials are returned", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: "biz-token" }))
      .mockResolvedValueOnce(jsonResponse({ credentials: { accessToken: "evil", n: 1 } }));

    await oauthService.completeWithCode("org-1", "p", "the-code");

    expect(updateAuthState).toHaveBeenCalledTimes(1);
  });
});

describe("oauthService.initiateOAuth", () => {
  it("rejects plugins whose oauth2 connectFlow is client", async () => {
    findByPluginId.mockResolvedValue(registryPlugin({ connectFlow: "client" }));

    await expect(oauthService.initiateOAuth("p", "org-1", "u-1")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This plugin connects from its settings page",
    });
  });
});

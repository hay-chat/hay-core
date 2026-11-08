const findByPluginId = jest.fn();
const findByOrgAndPlugin = jest.fn();
const clearAuthState = jest.fn();
const updateAuthState = jest.fn();
const clearForInstance = jest.fn();
const claimRoutes = jest.fn();
const countForInstance = jest.fn();
const stopPluginWorker = jest.fn();
const startPluginWorker = jest.fn();

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin, clearAuthState, updateAuthState },
}));
jest.mock("@server/repositories/plugin-webhook-route.repository", () => ({
  pluginWebhookRouteRepository: { clearForInstance, claimRoutes, countForInstance },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { stopPluginWorker, startPluginWorker },
}));
jest.mock("@server/services/oauth-state.service", () => ({
  oauthStateService: {},
}));

import { oauthService } from "../../services/oauth.service";

describe("oauthService.revokeOAuth", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findByPluginId.mockResolvedValue({ id: "reg-1", pluginId: "p" });
    findByOrgAndPlugin.mockResolvedValue({ id: "inst-1", organizationId: "org-1" });
    clearAuthState.mockResolvedValue(undefined);
    clearForInstance.mockResolvedValue(undefined);
    stopPluginWorker.mockResolvedValue(undefined);
  });

  it("clears auth state, drops the instance's webhook routes and stops the worker", async () => {
    await oauthService.revokeOAuth("org-1", "p");

    expect(clearAuthState).toHaveBeenCalledWith("inst-1", "org-1");
    expect(clearForInstance).toHaveBeenCalledWith("inst-1");
    expect(stopPluginWorker).toHaveBeenCalledWith("org-1", "p");
  });

  it("still resolves when the worker cannot be stopped", async () => {
    stopPluginWorker.mockRejectedValue(new Error("no worker"));

    await expect(oauthService.revokeOAuth("org-1", "p")).resolves.toBeUndefined();
    expect(clearForInstance).toHaveBeenCalledWith("inst-1");
  });

  it("throws and changes nothing when the instance is missing", async () => {
    findByOrgAndPlugin.mockResolvedValue(null);

    await expect(oauthService.revokeOAuth("org-1", "p")).rejects.toThrow(
      "Plugin instance not found",
    );
    expect(clearAuthState).not.toHaveBeenCalled();
    expect(clearForInstance).not.toHaveBeenCalled();
    expect(stopPluginWorker).not.toHaveBeenCalled();
  });
});

describe("oauthService.runOnConnected", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findByOrgAndPlugin.mockResolvedValue({
      id: "inst-1",
      organizationId: "org-1",
      config: {},
      authState: { methodId: "p-oauth", credentials: { accessToken: "t" } },
    });
    startPluginWorker.mockResolvedValue({ port: 4321 });
    clearForInstance.mockResolvedValue(undefined);
    claimRoutes.mockResolvedValue({ conflicts: [], previousOwners: [] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routingKeys: ["WABA1", "PN1"] }),
    }) as unknown as typeof fetch;
  });

  it("replaces the instance's routing keys on reconnect", async () => {
    await (
      oauthService as unknown as {
        runOnConnected: (org: string, plugin: string) => Promise<void>;
      }
    ).runOnConnected("org-1", "p");

    expect(claimRoutes).toHaveBeenCalledWith("p", "org-1", "inst-1", ["WABA1", "PN1"], {
      allowTransfer: false,
    });
  });

  const runOnConnected = (org: string, plugin: string) =>
    (
      oauthService as unknown as {
        runOnConnected: (org: string, plugin: string) => Promise<void>;
      }
    ).runOnConnected(org, plugin);

  const previousOwner = { organizationId: "org-old", pluginInstanceId: "inst-old" };

  it("disconnects the previous organization once the account moved away from it", async () => {
    findByPluginId.mockResolvedValue({ pluginId: "p", sourceType: "core" });
    claimRoutes.mockResolvedValue({ conflicts: [], previousOwners: [previousOwner] });
    countForInstance.mockResolvedValue(0);
    findByOrgAndPlugin.mockImplementation(async (org: string) =>
      org === "org-old"
        ? { id: "inst-old", organizationId: "org-old" }
        : {
            id: "inst-1",
            organizationId: "org-1",
            config: {},
            authState: { methodId: "p-oauth", credentials: { accessToken: "t" } },
          },
    );

    await runOnConnected("org-1", "p");

    expect(claimRoutes).toHaveBeenCalledWith("p", "org-1", "inst-1", ["WABA1", "PN1"], {
      allowTransfer: true,
    });
    expect(countForInstance).toHaveBeenCalledWith("inst-old");
    expect(clearAuthState).toHaveBeenCalledWith("inst-old", "org-old");
    expect(stopPluginWorker).toHaveBeenCalledWith("org-old", "p");
    expect(clearAuthState).not.toHaveBeenCalledWith("inst-1", expect.anything());
  });

  it("keeps the previous organization connected while it still owns other accounts", async () => {
    claimRoutes.mockResolvedValue({ conflicts: [], previousOwners: [previousOwner] });
    countForInstance.mockResolvedValue(1);

    await runOnConnected("org-1", "p");

    expect(clearAuthState).not.toHaveBeenCalled();
  });

  it("does not treat its own earlier keys as a move", async () => {
    await runOnConnected("org-1", "p");

    expect(countForInstance).not.toHaveBeenCalled();
    expect(clearAuthState).not.toHaveBeenCalled();
  });

  it("reports a failed connection when the keys belong to another organization", async () => {
    claimRoutes.mockResolvedValue({ conflicts: ["WABA1"], previousOwners: [] });

    await expect(runOnConnected("org-1", "p")).resolves.toEqual({
      ok: false,
      routingKeyCount: 0,
    });
    expect(clearAuthState).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const socketFetch = jest.fn<(...args: unknown[]) => Promise<Response>>();
const revokePluginApiToken = jest.fn<(token: string) => Promise<void>>();

jest.mock("@server/lib/worker-client", () => ({ socketFetch }));
jest.mock("@server/lib/plugin-isolation", () => ({ pluginHostSocketPath: () => "/run/host.sock" }));
jest.mock("@server/lib/plugin-api-token", () => ({ revokePluginApiToken }));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { reapPluginHostWorkers } from "@server/services/plugin-host.client";

describe("reapPluginHostWorkers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    revokePluginApiToken.mockResolvedValue(undefined);
  });

  it("revokes the tokens of the workers the host stopped", async () => {
    socketFetch.mockResolvedValue(
      new Response(JSON.stringify({ stopped: 2, apiTokens: ["token-a", "token-b"] })),
    );

    await expect(reapPluginHostWorkers()).resolves.toBe(2);

    expect(revokePluginApiToken.mock.calls.map(([token]) => token)).toEqual(["token-a", "token-b"]);
  });

  it("revokes nothing when the host stopped no workers", async () => {
    socketFetch.mockResolvedValue(new Response(JSON.stringify({ stopped: 0, apiTokens: [] })));

    await expect(reapPluginHostWorkers()).resolves.toBe(0);

    expect(revokePluginApiToken).not.toHaveBeenCalled();
  });
});

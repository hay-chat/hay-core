/**
 * Remote MCP servers are reached through the SSRF-safe fetch: every resolved
 * address is checked, the connection is pinned and redirects are not followed.
 */
import { describe, it, expect, afterEach, beforeEach, jest } from "@jest/globals";
import dnsPromises from "dns/promises";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/oauth-auth-strategy.service", () => ({
  oauthAuthStrategy: { getHeaders: async () => ({ Authorization: "Bearer t" }) },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin: async () => null },
}));
jest.mock("@server/lib/auth/utils/encryption", () => ({ decryptConfig: (c: unknown) => c }));

import { RemoteMCPClient } from "@server/services/remote-mcp-client.service";

const realFetch = global.fetch;
const fetchMock = jest.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function client(url: string) {
  return new RemoteMCPClient(url, "org-1", "plugin-1");
}

describe("RemoteMCPClient", () => {
  it.each(["http://127.0.0.1:8080/mcp", "http://[::1]/mcp", "http://0x7f.1/mcp", "ftp://x/"])(
    "never sends a request to %s",
    async (url) => {
      await expect(client(url).connect()).rejects.toThrow(/Blocked/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a hostname that resolves to a private address", async () => {
    jest
      .spyOn(dnsPromises, "lookup")
      .mockResolvedValue([{ address: "10.0.0.8", family: 4 }] as never);
    await expect(client("https://mcp.internal.example/mcp").connect()).rejects.toThrow(
      /private\/internal/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to a public server without following redirects, with a timeout", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: {} }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await client("https://93.184.216.34/mcp").connect();

    const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.dispatcher).toBeDefined();
  });

  it("treats a redirect as a failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 307, headers: { location: "http://169.254.169.254/" } }),
    );
    await expect(client("https://93.184.216.34/mcp").connect()).rejects.toThrow(/307/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

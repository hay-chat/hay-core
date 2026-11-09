import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import http from "http";
import net, { type AddressInfo } from "net";
import { EgressProxy } from "../../plugin-host/egress-proxy";

const PUBLIC_IP = "93.184.216.34";
const TOKEN = "a".repeat(32);
const OTHER_TOKEN = "b".repeat(32);

const names: Record<string, string[]> = {
  "api.allowed.test": [PUBLIC_IP],
  "internal.allowed.test": ["10.0.0.5"],
  "loopback.allowed.test": ["127.0.0.1"],
  "mapped.allowed.test": ["::ffff:10.0.0.5"],
  "mixed.allowed.test": [PUBLIC_IP, "169.254.169.254"],
  "metadata.allowed.test": ["169.254.169.254"],
  "other.test": [PUBLIC_IP],
};

describe("egress proxy", () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let proxy: EgressProxy;
  let proxyServer: http.Server;
  let proxyPort: number;
  const dialed: string[] = [];

  beforeAll(async () => {
    upstream = http.createServer((_req, res) => res.end("from upstream"));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    proxy = new EgressProxy(
      { maxConnectionsPerWorker: 4, idleTimeoutMs: 5000, maxDurationMs: 10_000 },
      async (host) => {
        if (!names[host]) throw new Error("ENOTFOUND");
        return names[host];
      },
      // Stands in for the internet: whatever address the proxy validated, reach the local stub.
      (address) => {
        dialed.push(address);
        return net.connect({ host: "127.0.0.1", port: upstreamPort });
      },
    );
    proxy.grant(TOKEN, {
      pluginId: "demo",
      orgId: "org-1",
      allow: [
        "api.allowed.test",
        "internal.allowed.test",
        "loopback.allowed.test",
        "mapped.allowed.test",
        "mixed.allowed.test",
        "metadata.allowed.test",
        "*.wild.test",
      ],
    });
    proxy.grant(OTHER_TOKEN, { pluginId: "other", orgId: "org-2", allow: ["other.test"] });
    proxyServer = proxy.createServer();
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    proxyServer.close();
    upstream.close();
  });

  function connect(target: string, token: string | null = TOKEN): Promise<number> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (token)
        headers["proxy-authorization"] = `Basic ${Buffer.from(`hay:${token}`).toString("base64")}`;
      const req = http.request({
        host: "127.0.0.1",
        port: proxyPort,
        method: "CONNECT",
        path: target,
        headers,
      });
      req.on("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
  }

  function get(
    url: string,
    token: string | null = TOKEN,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (token)
        headers["proxy-authorization"] = `Basic ${Buffer.from(`hay:${token}`).toString("base64")}`;
      const req = http.request(
        { host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("tunnels to a declared host and connects to the address it validated", async () => {
    dialed.length = 0;
    expect(await connect("api.allowed.test:443")).toBe(200);
    expect(dialed).toEqual([PUBLIC_IP]);
  });

  it("forwards plain HTTP to a declared host", async () => {
    const response = await get("http://api.allowed.test:443/x");
    expect(response).toEqual({ status: 200, body: "from upstream" });
  });

  it("refuses a worker with no token or an unknown one", async () => {
    expect(await connect("api.allowed.test:443", null)).toBe(403);
    expect(await connect("api.allowed.test:443", "c".repeat(32))).toBe(403);
  });

  it("refuses hosts the plugin did not declare, and other plugins' hosts", async () => {
    expect(await connect("other.test:443")).toBe(403);
    expect(await connect("example.com:443")).toBe(403);
    expect(await connect("api.allowed.test:22")).toBe(403);
    expect((await get("http://example.com/")).status).toBe(403);
  });

  it("refuses IP literals, even for an allowed address", async () => {
    expect(await connect(`${PUBLIC_IP}:443`)).toBe(403);
    expect(await connect("127.0.0.1:443")).toBe(403);
    expect(await connect("[::1]:443")).toBe(403);
  });

  it("refuses declared names that resolve to internal addresses, without dialing", async () => {
    dialed.length = 0;
    for (const host of [
      "internal.allowed.test",
      "loopback.allowed.test",
      "mapped.allowed.test",
      "mixed.allowed.test",
      "metadata.allowed.test",
    ]) {
      expect([host, await connect(`${host}:443`)]).toEqual([host, 403]);
    }
    expect(dialed).toEqual([]);
  });

  it("refuses names that do not resolve", async () => {
    expect(await connect("nothing.wild.test:443")).toBe(403);
  });

  it("stops granting a revoked worker", async () => {
    proxy.revoke(OTHER_TOKEN);
    expect(await connect("other.test:443", OTHER_TOKEN)).toBe(403);
  });
});

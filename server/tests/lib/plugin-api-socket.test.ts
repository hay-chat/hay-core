import { describe, expect, it } from "@jest/globals";
import { request } from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isPluginApiPath, listenPluginApiSocket } from "@server/lib/plugin-api-socket";

describe("plugin API socket", () => {
  it("allows only plugin API paths", () => {
    expect(isPluginApiPath("/v1/plugin-api/send-email")).toBe(true);
    expect(isPluginApiPath("/v1/pluginApi.state.get?batch=1")).toBe(true);
    expect(isPluginApiPath("/v1/pluginApi.a,pluginApi.b")).toBe(true);
    expect(isPluginApiPath("/v1/auth.login")).toBe(false);
    expect(isPluginApiPath("/v1/pluginApi.a,auth.login")).toBe(false);
    expect(isPluginApiPath("/v1/plugin-api/../auth.login")).toBe(false);
    expect(isPluginApiPath("/v1/plugins/x/webhook")).toBe(false);
    expect(isPluginApiPath("/health")).toBe(false);
    expect(isPluginApiPath(undefined)).toBe(false);
  });

  it("refuses paths the router or tRPC would resolve to something else", () => {
    expect(isPluginApiPath("/v1/plugin-api/health")).toBe(true);
    expect(isPluginApiPath("/v1/plugin-api/auth.login")).toBe(false);
    expect(isPluginApiPath("/v1/plugin-api/x/auth.login")).toBe(false);
    expect(isPluginApiPath("/v1/pluginApi.a/auth.login")).toBe(false);
    expect(isPluginApiPath("/v1/pluginApi.a%2Cauth.login")).toBe(false);
    expect(isPluginApiPath("/v1/pluginApi.a%2Fauth.login")).toBe(false);
    expect(isPluginApiPath("/v1/plugin-api/%2e%2e/auth.login")).toBe(false);
    expect(isPluginApiPath("http://core/v1/auth.login")).toBe(false);
  });

  it("serves the app for plugin API paths and answers 404 for anything else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-sock-"));
    const socketPath = join(dir, "api.sock");
    const server = await listenPluginApiSocket((req, res) => res.end(`app ${req.url}`), socketPath);
    const call = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ socketPath, path }, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on("error", reject);
        req.end();
      });
    try {
      expect(await call("/v1/pluginApi.state.get")).toEqual({
        status: 200,
        body: "app /v1/pluginApi.state.get",
      });
      expect((await call("/v1/auth.login")).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

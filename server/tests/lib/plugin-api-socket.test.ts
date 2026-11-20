import { describe, expect, it } from "@jest/globals";
import { spawnSync } from "child_process";
import { request } from "http";
import { createServer } from "net";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isPluginApiPath,
  isSignedMediaRead,
  listenPluginApiSocket,
  removeStaleApiSockets,
} from "@server/lib/plugin-api-socket";

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

  describe("signed media reads", () => {
    const id = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
    const signed = `/v1/media/${id}?expires=1893456000&sig=abc_DEF-123`;

    it("allows GET of one media file with exactly an expiry and a signature", () => {
      expect(isSignedMediaRead("GET", signed)).toBe(true);
      expect(isSignedMediaRead("GET", `/v1/media/${id.toUpperCase()}?sig=x&expires=1`)).toBe(true);
    });

    it.each([
      ["another method", "POST", signed],
      ["no method", undefined, signed],
      ["no signature", "GET", `/v1/media/${id}`],
      ["an empty signature", "GET", `/v1/media/${id}?expires=1&sig=`],
      ["no expiry", "GET", `/v1/media/${id}?sig=x`],
      ["an extra parameter", "GET", `${signed}&access_token=x`],
      ["a repeated parameter", "GET", `${signed}&sig=y`],
      ["a path below the file", "GET", `/v1/media/${id}/extra?expires=1&sig=x`],
      ["a trailing slash", "GET", `/v1/media/${id}/?expires=1&sig=x`],
      ["a path that is not a uuid", "GET", "/v1/media/not-a-uuid?expires=1&sig=x"],
      ["the media folder itself", "GET", "/v1/media?expires=1&sig=x"],
      [
        "an encoded character",
        "GET",
        `/v1/media/%30b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8?expires=1&sig=x`,
      ],
      ["a parent directory", "GET", `/v1/media/${id}/../${id}?expires=1&sig=x`],
      ["another prefix", "GET", `/v1/plugin-api/media/${id}?expires=1&sig=x`],
      ["an absolute URL", "GET", `http://core${signed}`],
    ])("refuses %s", (_label, method, url) => {
      expect(isSignedMediaRead(method, url)).toBe(false);
    });

    it("is not a plugin API path, so a route is never served for both reasons", () => {
      expect(isPluginApiPath(signed)).toBe(false);
    });
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

      const id = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
      expect((await call(`/v1/media/${id}?expires=1893456000&sig=abc`)).status).toBe(200);
      expect((await call(`/v1/media/${id}`)).status).toBe(404);
      expect((await call("/v1/media")).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes the sockets of cores that are gone and keeps a running core's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-stale-"));
    const live = join(dir, "core-aaaaaaaaaaaa.sock");
    const dead = join(dir, "core-bbbbbbbbbbbb.sock");
    const other = join(dir, "control.sock");
    const listeners = [live, dead, other].map(() => createServer());
    try {
      await Promise.all(
        [live, dead, other].map(
          (path, index) => new Promise<void>((resolve) => listeners[index].listen(path, resolve)),
        ),
      );
      // The dead core's socket file stays behind when it stops uncleanly.
      listeners[1].unref();
      await new Promise<void>((resolve) => listeners[1].close(() => resolve()));
      // A process killed outright leaves its socket file behind, refusing connections.
      spawnSync(process.execPath, [
        "-e",
        `require("net").createServer().listen(${JSON.stringify(dead)},()=>process.kill(process.pid,"SIGKILL"))`,
      ]);

      expect(await removeStaleApiSockets(dir, 10)).toBe(1);
      expect(existsSync(live)).toBe(true);
      expect(existsSync(other)).toBe(true);
      expect(existsSync(dead)).toBe(false);
    } finally {
      listeners.forEach((listener) => listener.close());
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

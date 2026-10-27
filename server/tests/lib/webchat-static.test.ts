import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import {
  webchatStatic,
  LOADER_CACHE_CONTROL,
  HASHED_CACHE_CONTROL,
} from "@server/lib/webchat-static";

function get(port: number, urlPath: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path: urlPath }, (res) => {
        res.resume();
        res.on("end", () => resolve(res));
      })
      .on("error", reject);
  });
}

describe("webchatStatic", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hay-webchat-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "widget.js"), "/* loader */");
    fs.writeFileSync(path.join(dir, "assets", "chat-abc123.js"), "export function mountChat(){}");

    const app = express();
    app.use("/v1/webchat", webchatStatic(dir));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves the loader with a short cache, so a deploy reaches shoppers within minutes", async () => {
    const res = await get(port, "/v1/webchat/widget.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(LOADER_CACHE_CONTROL);
    expect(res.headers["etag"]).toBeTruthy();
  });

  it("serves hashed chunks as immutable, loadable cross-origin as modules", async () => {
    const res = await get(port, "/v1/webchat/assets/chat-abc123.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe(HASHED_CACHE_CONTROL);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

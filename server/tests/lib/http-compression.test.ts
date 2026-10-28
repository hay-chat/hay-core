import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import express from "express";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import type { AddressInfo } from "net";
import { httpCompression } from "@server/lib/http-compression";

interface Fetched {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function get(port: number, urlPath: string, acceptEncoding?: string): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        port,
        path: urlPath,
        headers: acceptEncoding ? { "Accept-Encoding": acceptEncoding } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
  });
}

describe("httpCompression", () => {
  let server: http.Server;
  let port: number;
  const widget = "/* widget */\n" + "function hello(){return 'Hay.chat widget';}\n".repeat(3000);

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hay-compression-"));
    fs.writeFileSync(path.join(dir, "widget.js"), widget);

    const app = express();
    app.use(httpCompression());
    app.use("/v1/webchat", express.static(dir, { etag: true }));
    app.get("/v1/json", (_req, res) => {
      res.json({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item-${i}` })) });
    });
    app.get("/v1/tiny", (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/v1/events", (_req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.end("data: " + "x".repeat(4000) + "\n\n");
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves widget.js with brotli when accepted, and it decodes to the original", async () => {
    const res = await get(port, "/v1/webchat/widget.js", "gzip, deflate, br");
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["vary"]).toMatch(/Accept-Encoding/i);
    expect(res.body.length).toBeLessThan(widget.length / 5);
    expect(zlib.brotliDecompressSync(res.body).toString()).toBe(widget);
  });

  it("falls back to gzip, and to identity when nothing is accepted", async () => {
    const gz = await get(port, "/v1/webchat/widget.js", "gzip");
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(gz.body).toString()).toBe(widget);

    const plain = await get(port, "/v1/webchat/widget.js");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString()).toBe(widget);
  });

  it("compresses API JSON but leaves tiny responses alone", async () => {
    expect((await get(port, "/v1/json", "br")).headers["content-encoding"]).toBe("br");
    expect((await get(port, "/v1/tiny", "br")).headers["content-encoding"]).toBeUndefined();
  });

  it("never compresses server-sent events", async () => {
    const res = await get(port, "/v1/events", "gzip, br");
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});

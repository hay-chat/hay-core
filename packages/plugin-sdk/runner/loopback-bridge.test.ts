import { describe, it, expect, afterEach } from "vitest";
import net from "net";
import http from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startLoopbackBridge, BRIDGE_HOST } from "./loopback-bridge.js";

describe("loopback bridge", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it("carries a loopback HTTP request to a unix socket server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "api.sock");
    const upstream = http.createServer((req, res) => res.end(`hello ${req.url}`));
    await new Promise<void>((resolve) => upstream.listen(socketPath, resolve));
    cleanups.push(() => upstream.close());

    const probe = net.createServer().listen(0, BRIDGE_HOST);
    await new Promise((resolve) => probe.once("listening", resolve));
    const port = (probe.address() as net.AddressInfo).port;
    probe.close();
    await new Promise((resolve) => probe.once("close", resolve));

    const bridge = await startLoopbackBridge(port, socketPath);
    cleanups.push(() => bridge.close());

    const response = await fetch(`http://${BRIDGE_HOST}:${port}/v1/ping`);
    expect(await response.text()).toBe("hello /v1/ping");
  });
});

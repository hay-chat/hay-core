/**
 * The egress proxy's decision counts reach core's metrics: the proxy reports
 * them on its control socket, the supervisor passes them on in its status, and
 * core exposes them as hay_plugin_egress_decisions_total.
 */
import { describe, expect, it, jest } from "@jest/globals";
import http from "http";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const getPluginHostStatus = jest.fn<() => Promise<unknown>>();
const reapPluginHostWorkers = jest.fn(async () => 0);
jest.mock("@server/services/plugin-host.client", () => ({
  getPluginHostStatus,
  reapPluginHostWorkers,
}));

import { createEgressRegistrar } from "@server/plugin-host/egress-client";
import { initPluginIsolation } from "@server/services/plugin-isolation.service";
import { renderMetrics } from "@server/lib/metrics";

async function withControlSocket<T>(
  reply: (res: http.ServerResponse) => void,
  run: (socketPath: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), "egress-ctl-"));
  const socketPath = path.join(dir, "control.sock");
  const server = http.createServer((req, res) => {
    expect(req.url).toBe("/status");
    reply(res);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    return await run(socketPath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("egress registrar decisions", () => {
  it("reads the counts from the proxy's control socket", async () => {
    await withControlSocket(
      (res) => res.writeHead(200).end(JSON.stringify({ allowed: 7, denied: 2 })),
      async (socketPath) => {
        const registrar = createEgressRegistrar("/unused", socketPath);
        await expect(registrar.decisions()).resolves.toEqual({ allowed: 7, denied: 2 });
      },
    );
  });

  it("reports an unreachable or confused proxy as null", async () => {
    const missing = createEgressRegistrar("/unused", "/nonexistent/control.sock");
    await expect(missing.decisions()).resolves.toBeNull();

    await withControlSocket(
      (res) => res.writeHead(200).end("not json"),
      async (socketPath) => {
        await expect(createEgressRegistrar("/unused", socketPath).decisions()).resolves.toBeNull();
      },
    );
    await withControlSocket(
      (res) => res.writeHead(500).end(JSON.stringify({ allowed: 1, denied: 1 })),
      async (socketPath) => {
        await expect(createEgressRegistrar("/unused", socketPath).decisions()).resolves.toBeNull();
      },
    );
  });
});

describe("hay_plugin_egress_decisions_total", () => {
  it("exposes the proxy's counts by decision", async () => {
    process.env.PLUGIN_ISOLATION = "strict";
    getPluginHostStatus.mockResolvedValue({
      tier: 1,
      tierName: "bwrap",
      reason: null,
      mode: "strict",
      egress: "ready",
      egressDecisions: { allowed: 12, denied: 3 },
      workers: 1,
    });

    await initPluginIsolation();
    const text = await renderMetrics();

    expect(text).toContain('hay_plugin_egress_decisions_total{decision="allowed"} 12');
    expect(text).toContain('hay_plugin_egress_decisions_total{decision="denied"} 3');
    delete process.env.PLUGIN_ISOLATION;
  });
});

import { afterEach, describe, expect, it } from "@jest/globals";
import { spawn } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { request } from "http";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";
import type { Launcher } from "../../plugin-host/launcher";
import { Supervisor } from "../../plugin-host/supervisor";

const scripted = (script: string): Launcher => ({
  tier: 3,
  sockets: (spec) => ({ worker: spec.workerSocket, api: spec.apiSocket, egress: null }),
  prepareDir: async (spec) => void mkdirSync(spec.workerDir, { recursive: true }),
  spawn: () => spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] }),
  signal: (child, _spec, signal) => void child.kill(signal),
  cleanup: async () => undefined,
});

function call(socketPath: string, method: string, path: string, body?: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve(text));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe("supervisor worker events", () => {
  let dir = "";
  let supervisor: Supervisor | null = null;

  afterEach(async () => {
    await supervisor?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function startWorker(script: string): Promise<string> {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "sup-")));
    mkdirSync(join(dir, "plugins/demo"), { recursive: true });
    const controlSocket = join(dir, "control.sock");
    supervisor = new Supervisor({
      launcher: scripted(script),
      tierReason: null,
      mode: "degraded",
      rootDir: dir,
      workersDir: join(dir, "workers"),
      apiSocket: join(dir, "core.sock"),
      egress: null,
      controlSocket,
      coreGid: process.getgid?.() ?? 0,
      probeRecheckMs: 20,
    });
    await supervisor.listen();
    await call(controlSocket, "POST", "/workers", {
      id: "worker1",
      apiSocket: join(dir, "core-0123456789ab.sock"),
      custom: false,
      pluginId: "demo",
      orgId: "org",
      pluginPath: join(dir, "plugins/demo"),
      env: { HAY_API_TOKEN: "worker-token" },
      egressAllow: [],
    });
    return controlSocket;
  }

  async function events(script: string): Promise<Array<Record<string, unknown>>> {
    const controlSocket = await startWorker(script);
    const stream = await call(controlSocket, "GET", "/workers/worker1/events");
    return stream
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("reports a worker's exit once", async () => {
    const received = await events("setTimeout(()=>{console.log('hello');process.exit(3)},300)");
    expect(received.filter((event) => event.type === "exit")).toEqual([
      { type: "exit", code: 3, signal: null },
    ]);
    expect(received[0]).toEqual({ type: "log", stream: "stdout", line: "hello" });
  });

  it("breaks up output that never ends a line", async () => {
    const received = await events(
      "setTimeout(()=>{process.stdout.write('x'.repeat(200000),()=>process.exit(0))},300)",
    );
    const lines = received.filter((event) => event.type === "log");
    expect(lines.length).toBeGreaterThan(0);
    for (const event of lines) expect((event.line as string).length).toBeLessThanOrEqual(65536);
  });

  it("stops the workers of a core that is gone and keeps those of one that is running", async () => {
    const controlSocket = await startWorker("setInterval(()=>{},1000)");
    const status = () => call(controlSocket, "GET", "/status").then(JSON.parse);
    const core = createServer();
    await new Promise<void>((resolve) => core.listen(join(dir, "core-0123456789ab.sock"), resolve));

    expect(JSON.parse(await call(controlSocket, "POST", "/reap"))).toEqual({
      stopped: 0,
      apiTokens: [],
    });
    expect((await status()).workers).toBe(1);

    await new Promise((resolve) => core.close(resolve));
    expect(JSON.parse(await call(controlSocket, "POST", "/reap"))).toEqual({
      stopped: 1,
      apiTokens: ["worker-token"],
    });
    expect((await status()).workers).toBe(0);
  });

  it("releases the worker's resources when the process cannot be started", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "sup-")));
    mkdirSync(join(dir, "plugins/demo"), { recursive: true });
    const controlSocket = join(dir, "control.sock");
    const cleaned: string[] = [];
    supervisor = new Supervisor({
      launcher: {
        ...scripted(""),
        spawn: () => {
          throw new Error("spawn failed");
        },
        cleanup: async (spec) => void cleaned.push(spec.id),
      },
      tierReason: null,
      mode: "degraded",
      rootDir: dir,
      workersDir: join(dir, "workers"),
      apiSocket: join(dir, "core.sock"),
      egress: null,
      controlSocket,
      coreGid: process.getgid?.() ?? 0,
    });
    await supervisor.listen();

    const reply = JSON.parse(
      await call(controlSocket, "POST", "/workers", {
        id: "worker3",
        apiSocket: join(dir, "core-0123456789ab.sock"),
        custom: false,
        pluginId: "demo",
        orgId: "org",
        pluginPath: join(dir, "plugins/demo"),
        env: {},
        egressAllow: [],
      }),
    );

    expect(reply.error).toMatch(/spawn failed/);
    expect(cleaned).toEqual(["worker3"]);
  });

  it.each(["/tmp/core-0123456789ab.sock", "core-xyz.sock", "api.sock", ""])(
    "refuses a worker whose plugin API socket is %j",
    async (apiSocket) => {
      const controlSocket = await startWorker("setInterval(()=>{},1000)");
      const reply = JSON.parse(
        await call(controlSocket, "POST", "/workers", {
          id: "worker2",
          apiSocket: apiSocket && join(dir, apiSocket),
          custom: false,
          pluginId: "demo",
          orgId: "org",
          pluginPath: join(dir, "plugins/demo"),
          env: {},
          egressAllow: [],
        }),
      );
      expect(reply).toEqual({ error: "Invalid plugin API socket" });
    },
  );
});

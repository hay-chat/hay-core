/**
 * The plugin-host supervisor: starts, stops and reports on plugin workers for
 * core, and streams their output back. It runs in the `plugin-host` container,
 * which holds none of core's secrets and has no route to the database.
 *
 * Core talks to it over a unix socket (see protocol.ts). The supervisor loads
 * no plugin code itself.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { chmodSync, chownSync, mkdirSync, realpathSync, rmSync } from "fs";
import path from "path";
import { randomBytes, randomInt } from "crypto";
import type { ChildProcess } from "child_process";
import { log } from "./log";
import { removeWorkerDir, type Launcher, type LaunchSpec } from "./launcher";
import {
  WORKER_ID_PATTERN,
  TIER_NAMES,
  type HostStatus,
  type StartWorkerRequest,
  type StartWorkerResponse,
  type WorkerEvent,
} from "./protocol";

const LOG_BACKLOG_LINES = 200;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const STOP_GRACE_MS = 5000;
/** Loopback ports the workers' bridges use. Chosen per worker; only meaningful inside its sandbox. */
const BRIDGE_PORT_MIN = 31000;
const BRIDGE_PORT_MAX = 31999;

export interface SupervisorOptions {
  launcher: Launcher;
  tierReason: string | null;
  mode: "strict" | "degraded";
  /** Application root (contains packages/, node_modules/ and plugins/). */
  rootDir: string;
  /** Directory for per-worker directories. */
  workersDir: string;
  apiSocket: string;
  /** Egress hooks; null when the proxy is not configured. */
  egress: EgressRegistrar | null;
  controlSocket: string;
  /** Group core runs in; owns the control socket when the supervisor runs as root. */
  coreGid: number;
}

/** What the supervisor needs from the egress proxy. */
export interface EgressRegistrar {
  socketPath: string;
  /** Allow `token` to reach `allow` on behalf of a worker. Rejects if the proxy is unreachable. */
  register(
    token: string,
    worker: { pluginId: string; orgId: string; allow: string[] },
  ): Promise<void>;
  revoke(token: string): Promise<void>;
  isReachable(): Promise<boolean>;
}

interface RunningWorker {
  id: string;
  spec: LaunchSpec;
  child: ChildProcess;
  egressToken: string | null;
  backlog: WorkerEvent[];
  subscribers: Set<(event: WorkerEvent) => void>;
  exited: WorkerEvent | null;
  bridgePorts: number[];
}

export class Supervisor {
  private readonly workers = new Map<string, RunningWorker>();
  private readonly usedPorts = new Set<number>();
  private server: Server | null = null;
  private readonly allowedRoots: string[];

  constructor(private readonly options: SupervisorOptions) {
    this.allowedRoots = [path.join(options.rootDir, "plugins")];
  }

  async listen(): Promise<void> {
    mkdirSync(this.options.workersDir, { recursive: true });
    mkdirSync(path.dirname(this.options.controlSocket), { recursive: true });
    rmSync(this.options.controlSocket, { force: true });
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        log.error("Control request failed", { err: String(error) });
        if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
        else res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.options.controlSocket, resolve);
    });
    // Only core (same group) may drive the supervisor.
    chmodSync(this.options.controlSocket, 0o660);
    if (process.getuid?.() === 0) {
      chownSync(this.options.controlSocket, process.getuid(), this.options.coreGid);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers.keys()].map((id) => this.stopWorker(id)));
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  async status(): Promise<HostStatus> {
    return {
      tier: this.options.launcher.tier,
      tierName: TIER_NAMES[this.options.launcher.tier],
      reason: this.options.tierReason,
      mode: this.options.mode,
      egress:
        this.options.egress && (await this.options.egress.isReachable()) ? "ready" : "unavailable",
      workers: this.workers.size,
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://supervisor");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/status") {
      return sendJson(res, 200, await this.status());
    }
    if (req.method === "POST" && url.pathname === "/workers") {
      const body = (await readJson(req)) as StartWorkerRequest;
      const result = await this.startWorker(body);
      return sendJson(res, result.status, result.body);
    }
    if (parts[0] === "workers" && parts.length >= 2 && WORKER_ID_PATTERN.test(parts[1])) {
      const id = parts[1];
      if (req.method === "DELETE" && parts.length === 2) {
        await this.stopWorker(id);
        return sendJson(res, 200, { stopped: true });
      }
      if (req.method === "GET" && parts[2] === "events") {
        return this.streamEvents(id, res);
      }
    }
    sendJson(res, 404, { error: "Not found" });
  }

  private async startWorker(
    request: StartWorkerRequest,
  ): Promise<{ status: number; body: StartWorkerResponse | { error: string } }> {
    const invalid = this.validate(request);
    if (invalid) return { status: invalid.status, body: { error: invalid.error } };
    const { launcher, mode } = this.options;

    if (request.custom && launcher.tier === 3 && mode === "strict") {
      log.error("Refusing to start a custom plugin: workers are not isolated from each other", {
        pluginId: request.pluginId,
        tier: launcher.tier,
        reason: this.options.tierReason,
      });
      return {
        status: 403,
        body: {
          error:
            "This host cannot isolate plugins from each other, so custom plugins are refused " +
            "(PLUGIN_ISOLATION=strict). See SELF_HOSTING.md.",
        },
      };
    }
    if (this.workers.has(request.id)) {
      return { status: 409, body: { error: "Worker already running" } };
    }

    const workerDir = path.join(this.options.workersDir, request.id);
    const bridgePorts = [this.allocateBridgePort(), this.allocateBridgePort()];
    let egressToken: string | null = null;
    try {
      const prepared = await this.prepare(request, workerDir, bridgePorts);
      const spec = prepared.spec;
      egressToken = prepared.egressToken;
      if (egressToken) {
        await this.options.egress!.register(egressToken, {
          pluginId: request.pluginId,
          orgId: request.orgId,
          allow: request.egressAllow,
        });
      }

      const child = launcher.spawn(spec);
      const worker: RunningWorker = {
        id: request.id,
        spec,
        child,
        egressToken,
        backlog: [],
        subscribers: new Set(),
        exited: null,
        bridgePorts,
      };
      this.workers.set(request.id, worker);
      this.watch(worker);
      return {
        status: 200,
        body: { socketPath: spec.workerSocket, pid: child.pid ?? null },
      };
    } catch (error) {
      this.releasePorts(bridgePorts);
      if (egressToken) await this.options.egress?.revoke(egressToken).catch(() => undefined);
      removeWorkerDir(workerDir);
      log.error("Failed to start worker", { id: request.id, err: String(error) });
      return { status: 500, body: { error: `Failed to start worker: ${String(error)}` } };
    }
  }

  private validate(request: StartWorkerRequest): { status: number; error: string } | null {
    if (!request || typeof request !== "object") return { status: 400, error: "Invalid request" };
    if (!WORKER_ID_PATTERN.test(request.id ?? ""))
      return { status: 400, error: "Invalid worker id" };
    if (typeof request.pluginPath !== "string" || typeof request.orgId !== "string") {
      return { status: 400, error: "Invalid request" };
    }
    let real: string;
    try {
      real = realpathSync(request.pluginPath);
    } catch {
      return { status: 400, error: "Plugin directory not found" };
    }
    if (!this.allowedRoots.some((root) => real === root || real.startsWith(`${root}${path.sep}`))) {
      return { status: 400, error: "Plugin directory outside the plugins root" };
    }
    return null;
  }

  /** Create the worker directory and the complete environment its process will get. */
  private async prepare(
    request: StartWorkerRequest,
    workerDir: string,
    bridgePorts: number[],
  ): Promise<{ spec: LaunchSpec; egressToken: string | null }> {
    const { launcher, rootDir, apiSocket, egress } = this.options;
    const runnerPath = path.join(rootDir, "packages/plugin-sdk/dist/runner/index.js");
    const spec: LaunchSpec = {
      id: request.id,
      workerDir,
      workerSocket: path.join(workerDir, "worker.sock"),
      pluginPath: realpathSync(request.pluginPath),
      rootDir,
      runnerPath,
      args: [
        `--plugin-path=${realpathSync(request.pluginPath)}`,
        `--org-id=${request.orgId}`,
        `--port=${bridgePorts[0]}`,
        "--mode=production",
      ],
      env: {},
      apiSocket,
      egressSocket: egress?.socketPath ?? null,
    };
    await launcher.prepareDir(spec);
    const sockets = launcher.sockets(spec);

    const env: Record<string, string> = {
      ...request.env,
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: workerDir,
      HAY_WORKER_SOCKET: sockets.worker,
      HAY_API_SOCKET: sockets.api,
      HAY_API_BRIDGE_PORT: String(bridgePorts[0]),
      HAY_API_URL: `http://127.0.0.1:${bridgePorts[0]}`,
    };
    let egressToken: string | null = null;
    if (sockets.egress) {
      const token = randomToken();
      egressToken = token;
      const proxyUrl = `http://hay:${token}@127.0.0.1:${bridgePorts[1]}`;
      Object.assign(env, {
        HAY_EGRESS_SOCKET: sockets.egress,
        HAY_EGRESS_BRIDGE_PORT: String(bridgePorts[1]),
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        NODE_USE_ENV_PROXY: "1",
      });
    }
    spec.env = env;
    return { spec, egressToken };
  }

  private watch(worker: RunningWorker): void {
    const push = (event: WorkerEvent): void => {
      if (event.type === "log") {
        worker.backlog.push(event);
        if (worker.backlog.length > LOG_BACKLOG_LINES) worker.backlog.shift();
      }
      for (const subscriber of worker.subscribers) subscriber(event);
    };
    const pipe = (stream: "stdout" | "stderr"): void => {
      let pending = "";
      worker.child[stream]?.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) if (line) push({ type: "log", stream, line });
      });
      worker.child[stream]?.on("end", () => {
        if (pending) push({ type: "log", stream, line: pending });
      });
    };
    pipe("stdout");
    pipe("stderr");

    worker.child.on("error", (error) => {
      push({ type: "log", stream: "stderr", line: `spawn error: ${String(error)}` });
    });
    worker.child.on("exit", (code, signal) => {
      const event: WorkerEvent = { type: "exit", code, signal };
      worker.exited = event;
      this.workers.delete(worker.id);
      this.releasePorts(worker.bridgePorts);
      void this.finish(worker).finally(() => {
        push(event);
        for (const subscriber of worker.subscribers) subscriber(event);
        worker.subscribers.clear();
      });
    });
  }

  private async finish(worker: RunningWorker): Promise<void> {
    if (worker.egressToken)
      await this.options.egress?.revoke(worker.egressToken).catch(() => undefined);
    try {
      await this.options.launcher.cleanup(worker.spec);
    } catch (error) {
      log.warn("Worker cleanup failed", { id: worker.id, err: String(error) });
    }
    removeWorkerDir(worker.spec.workerDir);
  }

  private async stopWorker(id: string): Promise<void> {
    const worker = this.workers.get(id);
    if (!worker) return;
    const exited = new Promise<void>((resolve) => worker.child.once("exit", () => resolve()));
    this.options.launcher.signal(worker.child, worker.spec, "SIGTERM");
    const timer = setTimeout(
      () => this.options.launcher.signal(worker.child, worker.spec, "SIGKILL"),
      STOP_GRACE_MS,
    );
    await exited;
    clearTimeout(timer);
  }

  private streamEvents(id: string, res: ServerResponse): void {
    const worker = this.workers.get(id);
    if (!worker) return sendJson(res, 404, { error: "Worker not running" });
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const send = (event: WorkerEvent): void => {
      res.write(`${JSON.stringify(event)}\n`);
      if (event.type === "exit") res.end();
    };
    for (const event of worker.backlog) send(event);
    worker.subscribers.add(send);
    res.on("close", () => worker.subscribers.delete(send));
  }

  private allocateBridgePort(): number {
    for (let attempt = 0; attempt < 200; attempt++) {
      const port = randomInt(BRIDGE_PORT_MIN, BRIDGE_PORT_MAX + 1);
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error("No free bridge port");
  }

  private releasePorts(ports: number[]): void {
    for (const port of ports) this.usedPorts.delete(port);
  }
}

function randomToken(): string {
  return randomBytes(24).toString("hex");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

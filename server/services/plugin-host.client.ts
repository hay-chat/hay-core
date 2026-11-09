/**
 * Core's client for the plugin-host supervisor (server/plugin-host/).
 *
 * With PLUGIN_ISOLATION set, plugin workers run in the plugin-host container
 * instead of as children of this process. {@link launchInPluginHost} gives the
 * runner something that behaves like a child process, so the rest of the
 * runner does not care where the worker lives.
 */
import { EventEmitter } from "events";
import { socketFetch } from "@server/lib/worker-client";
import { pluginHostSocketPath } from "@server/lib/plugin-isolation";
import { createLogger } from "@server/lib/logger";
import type { WorkerProcess } from "../types/plugin-sdk.types";
import type {
  HostStatus,
  StartWorkerRequest,
  StartWorkerResponse,
  WorkerEvent,
} from "../plugin-host/protocol";

const logger = createLogger("plugin-host-client");
const HOST_URL = "http://plugin-host";

async function hostFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return socketFetch(pluginHostSocketPath(), `${HOST_URL}${path}`, init);
}

export async function getPluginHostStatus(): Promise<HostStatus> {
  const response = await hostFetch("/status", { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`plugin-host status returned ${response.status}`);
  return (await response.json()) as HostStatus;
}

/** A worker running in the plugin host, seen as a process. */
class RemoteWorkerProcess extends EventEmitter implements WorkerProcess {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  constructor(
    private readonly id: string,
    readonly pid: number | undefined,
  ) {
    super();
  }

  kill(): boolean {
    hostFetch(`/workers/${this.id}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => logger.warn({ err: error, id: this.id }, "Failed to stop worker"));
    return true;
  }

  /** Follow the supervisor's event stream until the worker exits. */
  async follow(): Promise<void> {
    let exited = false;
    try {
      const response = await hostFetch(`/workers/${this.id}/events`);
      if (!response.ok || !response.body) throw new Error(`events returned ${response.status}`);
      const decoder = new TextDecoder();
      let pending = "";
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as WorkerEvent;
          if (event.type === "log") {
            (event.stream === "stdout" ? this.stdout : this.stderr).emit("data", event.line);
          } else {
            exited = true;
            this.emit("exit", event.code, event.signal);
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error, id: this.id }, "Lost the plugin host event stream");
    }
    // A stream that ends without an exit event means the host went away.
    if (!exited) this.emit("exit", 1, null);
  }
}

export interface RemoteLaunch {
  process: WorkerProcess;
  socketPath: string;
}

export async function launchInPluginHost(request: StartWorkerRequest): Promise<RemoteLaunch> {
  const response = await hostFetch("/workers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as StartWorkerResponse | { error: string };
  if (!response.ok || "error" in body) {
    throw new Error("error" in body ? body.error : `plugin-host returned ${response.status}`);
  }
  const worker = new RemoteWorkerProcess(request.id, body.pid ?? undefined);
  void worker.follow();
  return { process: worker, socketPath: body.socketPath };
}

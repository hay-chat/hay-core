/**
 * Starts one worker process for a tier.
 *
 * The supervisor decides the tier once, at start-up (see tiers.ts); a launcher
 * only turns a {@link LaunchSpec} into a running process.
 */
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync } from "fs";
import path from "path";
import type { IsolationTier } from "./protocol";

export interface LaunchSpec {
  id: string;
  /** Per-worker directory holding its socket and scratch space (private to the worker). */
  workerDir: string;
  /** Unix socket the worker listens on, as the supervisor sees it. */
  workerSocket: string;
  /** Plugin directory. */
  pluginPath: string;
  /** Application root (contains packages/, node_modules/ and plugins/). */
  rootDir: string;
  runnerPath: string;
  args: string[];
  /** Complete environment for the worker; nothing is inherited from the supervisor. */
  env: Record<string, string>;
  /** Core's plugin API socket. */
  apiSocket: string;
  /** Egress proxy socket, when the proxy is reachable. */
  egressSocket: string | null;
  /** Tier 2: the uid and gid the worker runs as. */
  uid?: number;
}

export interface Launcher {
  tier: IsolationTier;
  /** Where the worker sees the sockets: tier 1 mounts them at fixed paths. */
  sockets(spec: LaunchSpec): { worker: string; api: string; egress: string | null };
  /** Create the worker directory (and whatever the tier needs in it). */
  prepareDir(spec: LaunchSpec): Promise<void>;
  spawn(spec: LaunchSpec): ChildProcess;
  /** Remove what the worker left behind and make sure none of its processes survive. */
  cleanup(spec: LaunchSpec): Promise<void>;
}

/** Node's permission model: file reads limited to what a plugin needs. */
export function permissionFlags(spec: LaunchSpec): string[] {
  const reads = [
    path.join(spec.rootDir, "package.json"),
    path.join(spec.rootDir, "node_modules"),
    path.join(spec.rootDir, "packages"),
    spec.pluginPath,
    spec.workerDir,
    "/etc/ssl",
    "/etc/ca-certificates",
    "/usr/share/zoneinfo",
  ];
  return [
    "--permission",
    ...reads.map((p) => `--allow-fs-read=${p}`),
    `--allow-fs-write=${spec.workerDir}`,
    "--allow-child-process",
    "--allow-worker",
  ];
}

export function nodeArgs(spec: LaunchSpec, extra: string[] = []): string[] {
  return [...extra, spec.runnerPath, ...spec.args];
}

/** Tier 3: a plain child process of the supervisor, with only the Node permission model around it. */
export const sameUidLauncher: Launcher = {
  tier: 3,
  sockets: (spec) => ({
    worker: spec.workerSocket,
    api: spec.apiSocket,
    egress: spec.egressSocket,
  }),
  async prepareDir(spec) {
    mkdirSync(path.join(spec.workerDir, "tmp"), { recursive: true, mode: 0o700 });
  },
  spawn(spec) {
    return spawn(process.execPath, nodeArgs(spec, permissionFlags(spec)), {
      env: { ...spec.env, TMPDIR: path.join(spec.workerDir, "tmp") },
      stdio: ["ignore", "pipe", "pipe"],
      cwd: path.dirname(spec.runnerPath),
      detached: true,
    });
  },
  async cleanup() {
    // The process group is killed by the supervisor; the directory is removed there.
  },
};

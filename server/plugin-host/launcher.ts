/**
 * Starts one worker process for a tier.
 *
 * The supervisor decides the tier once, at start-up (see tiers.ts); a launcher
 * only turns a {@link LaunchSpec} into a running process.
 */
import { spawn, spawnSync, type ChildProcess } from "child_process";
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { buildSeccompFilter } from "./seccomp";
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
  /** Send a signal to the worker and everything it started. */
  signal(child: ChildProcess, spec: LaunchSpec, signal: NodeJS.Signals): void;
  /** Remove what the worker left behind and make sure none of its processes survive. */
  cleanup(spec: LaunchSpec): Promise<void>;
}

/** Signal a worker's process group (workers are started detached, as group leaders). */
export function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
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
  signal: (child, _spec, signal) => signalGroup(child, signal),
  async cleanup() {
    // The directory is removed by the supervisor.
  },
};

/**
 * Remove a worker directory. After a tier 2 cleanup it is empty but belongs to
 * another user, which the supervisor can remove only with rmdir.
 */
export function removeWorkerDir(dir: string): void {
  try {
    rmdirSync(dir);
  } catch {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run inside the probe sandbox: exit 0 only if the sandbox has its own mount
 * namespace (the binds above succeeded to get this far) and the seccomp filter
 * refuses a nested user namespace.
 */
const PROBE_SCRIPT =
  "const r=require('child_process').spawnSync('unshare',['-U','true']);process.exit(r.status===0?3:0)";

/** Library directories that exist on this machine (arm64 has no /lib64). */
function existing(paths: string[]): string[] {
  return paths.filter((p) => existsSync(p));
}

/**
 * The bubblewrap command line for a worker. The worker sees only: the system
 * directories read-only, the SDK and dependencies read-only, its own plugin
 * directory read-only, a small tmpfs, its own directory, and the two sockets.
 * No /proc, no network, no other plugin. Secrets travel in bubblewrap's
 * environment, not in this command line, which other processes can read.
 */
export function bwrapArgs(spec: LaunchSpec, command: string[]): string[] {
  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--seccomp",
    "3",
    "--ro-bind",
    "/usr",
    "/usr",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/lib",
    "/lib",
  ];
  for (const lib of existing(["/lib64"])) args.push("--symlink", "usr/lib64", lib);
  args.push(
    "--ro-bind-try",
    "/etc/ssl",
    "/etc/ssl",
    "--ro-bind-try",
    path.join(spec.rootDir, "package.json"),
    path.join(spec.rootDir, "package.json"),
    "--ro-bind",
    path.join(spec.rootDir, "node_modules"),
    path.join(spec.rootDir, "node_modules"),
    "--ro-bind",
    path.join(spec.rootDir, "packages"),
    path.join(spec.rootDir, "packages"),
    "--ro-bind",
    spec.pluginPath,
    spec.pluginPath,
    "--size",
    String(64 * 1024 * 1024),
    "--tmpfs",
    "/tmp",
    "--dev",
    "/dev",
    "--bind",
    spec.workerDir,
    "/run/worker",
  );
  args.push("--bind", spec.apiSocket, "/run/api.sock");
  if (spec.egressSocket) args.push("--bind", spec.egressSocket, "/run/egress.sock");
  args.push("--chdir", path.dirname(spec.runnerPath), "--", ...command);
  return args;
}

function openSeccomp(): number {
  const file = path.join(os.tmpdir(), `hay-seccomp-${process.pid}.bpf`);
  writeFileSync(file, buildSeccompFilter(), { mode: 0o600 });
  // One descriptor per child: children share the file offset of a descriptor they inherit.
  const fd = openSync(file, "r");
  rmSync(file, { force: true });
  return fd;
}

/** Tier 1: bubblewrap. */
export const bwrapLauncher: Launcher = {
  tier: 1,
  sockets: (spec) => ({
    worker: "/run/worker/worker.sock",
    api: "/run/api.sock",
    egress: spec.egressSocket ? "/run/egress.sock" : null,
  }),
  async prepareDir(spec) {
    mkdirSync(spec.workerDir, { recursive: true, mode: 0o700 });
  },
  spawn(spec) {
    const fd = openSeccomp();
    try {
      return spawn("bwrap", bwrapArgs(spec, [process.execPath, ...nodeArgs(spec)]), {
        env: { ...spec.env, HOME: "/run/worker", TMPDIR: "/tmp" },
        stdio: ["ignore", "pipe", "pipe", fd],
        detached: true,
      });
    } finally {
      closeSync(fd);
    }
  },
  signal: (child, _spec, signal) => signalGroup(child, signal),
  async cleanup() {
    // The sandbox's process tree ends with bubblewrap; the directory is removed by the supervisor.
  },
};

/** Run a probe sandbox and return the failure text, or null when it started. */
export function probeBwrap(): string | null {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hay-probe-"));
  const rootDir = process.cwd().endsWith("/server")
    ? path.join(process.cwd(), "..")
    : process.cwd();
  const spec: LaunchSpec = {
    id: "probe",
    workerDir: dir,
    workerSocket: path.join(dir, "worker.sock"),
    pluginPath: path.join(rootDir, "packages"),
    rootDir,
    runnerPath: path.join(rootDir, "packages/plugin-sdk/dist/runner/index.js"),
    args: [],
    env: {},
    apiSocket: path.join(dir, "api.sock"),
    egressSocket: null,
  };
  writeFileSync(spec.apiSocket, "");
  const fd = openSeccomp();
  try {
    const result = spawnSync("bwrap", bwrapArgs(spec, [process.execPath, "-e", PROBE_SCRIPT]), {
      stdio: ["ignore", "ignore", "pipe", fd],
      timeout: 10_000,
    });
    if (result.error) return `bwrap could not run: ${result.error.message}`;
    if (result.status === 0) return null;
    return (
      result.stderr.toString().trim().split("\n").slice(0, 3).join(" ") || `exit ${result.status}`
    );
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Tier 2 parameters. */
const UID_BASE = 20000;
const UID_COUNT = 10000;

function setprivArgs(uid: number): string[] {
  return [
    "--reuid",
    String(uid),
    "--regid",
    String(uid),
    "--clear-groups",
    "--bounding-set",
    "-all",
    "--inh-caps",
    "-all",
    "--no-new-privs",
  ];
}

/** Run a probe under `setpriv` as another user; the failure text, or null. */
export function probeUidSeparation(): string | null {
  const result = spawnSync(
    "setpriv",
    [...setprivArgs(UID_BASE), process.execPath, "-e", "process.exit(0)"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 10_000,
    },
  );
  if (result.error) return `setpriv could not run: ${result.error.message}`;
  if (result.status === 0) return null;
  return (
    result.stderr.toString().trim().split("\n").slice(0, 3).join(" ") || `exit ${result.status}`
  );
}

/**
 * Tier 2: one uid per worker. The supervisor is root with a handful of
 * capabilities and every worker drops all of them, plus the ability to regain
 * any, before it executes. The worker directory belongs to the worker and its
 * group is the group core runs in, so core can reach the worker's socket
 * (setgid makes the socket inherit that group) and no other worker can.
 */
export function createUidLauncher(coreGid: number): Launcher {
  const uids = new Map<string, number>();
  const inUse = new Set<number>();
  let cursor = 0;

  const allocate = (id: string): number => {
    for (let i = 0; i < UID_COUNT; i++) {
      const uid = UID_BASE + ((cursor + i) % UID_COUNT);
      if (!inUse.has(uid)) {
        cursor = (cursor + i + 1) % UID_COUNT;
        inUse.add(uid);
        uids.set(id, uid);
        return uid;
      }
    }
    throw new Error("No free worker user ids");
  };

  const asUser = (uid: number, command: string, args: string[]): void => {
    spawnSync("setpriv", [...setprivArgs(uid), command, ...args], {
      stdio: "ignore",
      timeout: 15_000,
    });
  };

  return {
    tier: 2,
    sockets: (spec) => ({
      worker: spec.workerSocket,
      api: spec.apiSocket,
      egress: spec.egressSocket,
    }),
    async prepareDir(spec) {
      const uid = allocate(spec.id);
      spec.uid = uid;
      mkdirSync(path.join(spec.workerDir, "tmp"), { recursive: true });
      // Mode before owner: changing the mode of another user's file needs a capability we don't hold.
      chmodSync(spec.workerDir, 0o2710);
      chmodSync(path.join(spec.workerDir, "tmp"), 0o700);
      chownSync(spec.workerDir, uid, coreGid);
      chownSync(path.join(spec.workerDir, "tmp"), uid, uid);
    },
    spawn(spec) {
      if (spec.uid === undefined) throw new Error("Worker has no user id");
      return spawn("setpriv", [...setprivArgs(spec.uid), process.execPath, ...nodeArgs(spec)], {
        env: {
          ...spec.env,
          TMPDIR: path.join(spec.workerDir, "tmp"),
          HOME: path.join(spec.workerDir, "tmp"),
        },
        stdio: ["ignore", "pipe", "pipe"],
        cwd: path.dirname(spec.runnerPath),
        detached: true,
      });
    },
    // The supervisor holds no CAP_KILL, so it signals as the worker's own user.
    signal(_child, spec, signal) {
      const uid = uids.get(spec.id);
      if (uid !== undefined) asUser(uid, "kill", [`-${signal.replace(/^SIG/, "")}`, "-1"]);
    },
    async cleanup(spec) {
      const uid = uids.get(spec.id);
      if (uid === undefined) return;
      // Nothing of this user may outlive the worker: the id is reused later.
      asUser(uid, "kill", ["-9", "-1"]);
      asUser(uid, "find", [spec.workerDir, "-mindepth", "1", "-delete"]);
      uids.delete(spec.id);
      inUse.delete(uid);
    },
  };
}

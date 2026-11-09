/**
 * Runs a stand-in for a compromised plugin under a launcher and reports which
 * boundaries held. `node dist/plugin-host/isolation-check.js` in the
 * plugin-host container prints the result for the tier it detected.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { removeWorkerDir, type Launcher, type LaunchSpec } from "./launcher";
import { detectLauncher } from "./tiers";

export interface Check {
  name: string;
  /** Tiers that must hold this boundary. */
  tiers: number[];
  ok: boolean;
  observed: string;
}

type Observation = Record<string, string | number | undefined>;

function collect(
  child: ReturnType<Launcher["spawn"]>,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("exit", () => resolve({ stdout, stderr }));
  });
}

export async function runIsolationChecks(
  launcher: Launcher,
  rootDir: string,
  workersDir: string,
): Promise<Check[]> {
  const probeSource = path.join(rootDir, "server/dist/plugin-host/isolation-probe-worker.js");
  const scratch = mkdtempSync(path.join(os.tmpdir(), "hay-check-"));
  // Under the workers directory: the plugins directory is read-only in the plugin host.
  const checkRoot = path.join(workersDir, "_check-plugins");
  const pluginDir = path.join(checkRoot, "subject");
  const otherPluginDir = path.join(checkRoot, "other");
  for (const dir of [pluginDir, otherPluginDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(otherPluginDir, "secret.txt"), "another plugin's file");
  // The sandbox shows a worker only its own plugin directory, so the probe lives there.
  const probe = path.join(pluginDir, "probe.js");
  copyFileSync(probeSource, probe);
  const apiSocket = path.join(scratch, "api.sock");
  writeFileSync(apiSocket, "");

  const specFor = (id: string, env: Record<string, string>, args: string[]): LaunchSpec => ({
    id,
    workerDir: path.join(workersDir, id),
    workerSocket: path.join(workersDir, id, "worker.sock"),
    pluginPath: pluginDir,
    rootDir,
    runnerPath: probe,
    args,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", ...env },
    apiSocket,
    egressSocket: null,
  });

  const foreignSpec = specFor("checkforeign", {}, ["--sleep"]);
  const subjectSpec = specFor("checksubject", {}, []);
  mkdirSync(workersDir, { recursive: true });
  try {
    await launcher.prepareDir(foreignSpec);
    foreignSpec.env.HOME = launcher.sockets(foreignSpec).worker.replace(/\/worker\.sock$/, "");
    const foreign = launcher.spawn(foreignSpec);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await launcher.prepareDir(subjectSpec);
    subjectSpec.env = {
      ...subjectSpec.env,
      HOME: launcher.sockets(subjectSpec).worker.replace(/\/worker\.sock$/, ""),
      PROBE_OTHER_PLUGIN_FILE: path.join(otherPluginDir, "secret.txt"),
      PROBE_OTHER_WORKER_FILE: path.join(foreignSpec.workerDir, "secret.txt"),
      PROBE_OWN_PLUGIN_DIR: pluginDir,
    };
    const { stdout, stderr } = await collect(launcher.spawn(subjectSpec));
    launcher.signal(foreign, foreignSpec, "SIGKILL");
    await launcher.cleanup(foreignSpec);
    await launcher.cleanup(subjectSpec);

    const line = stdout.trim().split("\n").pop() ?? "";
    let seen: Observation;
    try {
      seen = JSON.parse(line) as Observation;
    } catch {
      throw new Error(`The probe worker produced no result: ${stderr.trim() || stdout.trim()}`);
    }
    const denied = (key: string): boolean => String(seen[key]).startsWith("denied");
    const check = (name: string, key: string, tiers: number[]): Check => ({
      name,
      tiers,
      ok: denied(key),
      observed: String(seen[key]),
    });
    return [
      check("a worker cannot read another worker's files", "readsOtherWorkerFile", [1, 2]),
      check("a worker cannot read another plugin's files", "readsOtherPluginFile", [1]),
      check(
        "a worker cannot read the supervisor's environment",
        "readsSupervisorEnvironment",
        [1, 2],
      ),
      check("a worker cannot read the server's code", "readsServerCode", [1]),
      check("a worker cannot write into its plugin directory", "writesPluginDirectory", [1]),
      check("a worker cannot create a nested user namespace", "createsNestedUserNamespace", [1]),
      check("a worker has no direct route to the internet", "connectsToInternet", [1]),
      check("a worker cannot resolve names itself", "resolvesNames", [1]),
    ];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(pluginDir, { recursive: true, force: true });
    rmSync(checkRoot, { recursive: true, force: true });
    for (const spec of [foreignSpec, subjectSpec]) {
      try {
        await launcher.cleanup(spec);
        removeWorkerDir(spec.workerDir);
      } catch {
        // Best effort: the failure that got us here is the one worth reporting.
      }
    }
  }
}

async function cli(): Promise<void> {
  const rootDir = process.cwd().endsWith("/server")
    ? path.join(process.cwd(), "..")
    : process.cwd();
  const workersDir = process.env.PLUGIN_HOST_WORKERS_DIR ?? "/run/hay/w";
  const { launcher, reason } = detectLauncher(Number(process.env.PLUGIN_HOST_CORE_GID) || 10001);
  const checks = await runIsolationChecks(launcher, rootDir, workersDir);
  process.stdout.write(`tier ${launcher.tier}${reason ? ` (${reason})` : ""}\n`);
  let failed = false;
  for (const check of checks) {
    const required = check.tiers.includes(launcher.tier);
    if (required && !check.ok) failed = true;
    process.stdout.write(
      `${check.ok ? "held   " : required ? "FAILED " : "open   "} ${check.name}: ${check.observed}\n`,
    );
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  cli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(2);
  });
}

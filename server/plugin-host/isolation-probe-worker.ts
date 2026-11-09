/**
 * Stands in for a compromised plugin in isolation-check.ts: tries what a
 * hostile worker would try and prints what it saw as one JSON line. With
 * `--sleep` it only waits, so another probe can be pointed at it.
 */
import fs from "fs";
import net from "net";
import dns from "dns";
import { spawnSync } from "child_process";

function attempt(fn: () => unknown): string {
  try {
    fn();
    return "allowed";
  } catch (error) {
    return `denied:${(error as NodeJS.ErrnoException).code ?? "error"}`;
  }
}

function connect(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    socket.on("connect", () => {
      socket.destroy();
      resolve("allowed");
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve("denied:timeout");
    });
    socket.on("error", (error: NodeJS.ErrnoException) => resolve(`denied:${error.code}`));
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--sleep")) {
    fs.writeFileSync(`${process.env.HOME}/secret.txt`, "worker secret");
    setInterval(() => undefined, 1000);
    return;
  }
  const decoy = process.env.PROBE_OTHER_PLUGIN_FILE ?? "";
  const foreign = process.env.PROBE_OTHER_WORKER_FILE ?? "";
  const unshare = spawnSync("unshare", ["-U", "true"], { encoding: "utf8" });
  const result = {
    uid: process.getuid?.(),
    readsOtherPluginFile: attempt(() => fs.readFileSync(decoy)),
    readsOtherWorkerFile: attempt(() => fs.readFileSync(foreign)),
    readsSupervisorEnvironment: attempt(() => fs.readFileSync("/proc/1/environ")),
    readsServerCode: attempt(() => fs.readFileSync("/app/server/dist/main.js")),
    writesPluginDirectory: attempt(() =>
      fs.writeFileSync(`${process.env.PROBE_OWN_PLUGIN_DIR}/pwned`, "x"),
    ),
    createsNestedUserNamespace: unshare.status === 0 ? "allowed" : "denied",
    connectsToInternet: await connect("1.1.1.1", 443),
    resolvesNames: await new Promise<string>((resolve) =>
      dns.lookup("example.com", (error) => resolve(error ? `denied:${error.code}` : "allowed")),
    ),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

void main();

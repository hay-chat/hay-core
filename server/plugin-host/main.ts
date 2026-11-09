/**
 * Entry point of the `plugin-host` container (same image as core, different
 * command): `node dist/plugin-host/main.js`.
 */
import path from "path";
import { log } from "./log";
import { Supervisor } from "./supervisor";
import { detectLauncher } from "./tiers";
import { TIER_NAMES } from "./protocol";
import { createEgressRegistrar } from "./egress-client";

function envPath(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function main(): Promise<void> {
  const mode = process.env.PLUGIN_ISOLATION === "degraded" ? "degraded" : "strict";
  // Resolved like core resolves it: the server runs with cwd=<root>/server.
  const rootDir = process.cwd().endsWith("/server")
    ? path.join(process.cwd(), "..")
    : process.cwd();
  const workersDir = envPath("PLUGIN_HOST_WORKERS_DIR", "/run/hay/w");

  const coreGid = Number(process.env.PLUGIN_HOST_CORE_GID) || 10001;
  const { launcher, reason } = detectLauncher(coreGid);
  if (launcher.tier === 1) {
    log.info("Plugin isolation active", { tier: launcher.tier, tierName: TIER_NAMES[1], mode });
  } else {
    // Every start, with the exact reason, so a degraded host can't go unnoticed.
    log.error(
      launcher.tier === 2
        ? "Plugin workers are separated by user id only: the sandbox could not start"
        : "Plugin workers are NOT isolated from each other: neither the sandbox nor separate users are available",
      { tier: launcher.tier, tierName: TIER_NAMES[launcher.tier], mode, reason },
    );
  }

  const egressSocket = process.env.PLUGIN_EGRESS_SOCKET?.trim();
  const egressControl = process.env.PLUGIN_EGRESS_CONTROL_SOCKET?.trim();
  const supervisor = new Supervisor({
    launcher,
    tierReason: reason,
    mode,
    rootDir,
    workersDir,
    apiSocket: envPath("PLUGIN_API_SOCKET", "/run/hay/api/core.sock"),
    egress:
      egressSocket && egressControl ? createEgressRegistrar(egressSocket, egressControl) : null,
    controlSocket: envPath("PLUGIN_HOST_SOCKET", "/run/hay/ctl/control.sock"),
    coreGid,
  });
  await supervisor.listen();
  log.info("Plugin host listening", { tier: launcher.tier });

  const shutdown = (signal: string): void => {
    log.info("Shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    supervisor.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log.error("Plugin host failed to start", { err: String(error) });
  process.exit(1);
});

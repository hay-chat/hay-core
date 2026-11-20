/**
 * Reports how plugin workers are isolated: one start-up log, the
 * `hay_plugin_isolation_tier` metric and the detail shown by /ready.
 *
 * Tier 0 means the isolation path is off and workers are children of the
 * server (PLUGIN_ISOLATION unset).
 */
import { createLogger } from "@server/lib/logger";
import { registerCollector } from "@server/lib/metrics";
import { pluginIsolationMode, type PluginIsolationMode } from "@server/lib/plugin-isolation";
import { getPluginHostStatus, reapPluginHostWorkers } from "./plugin-host.client";
import type { EgressDecisions, HostStatus } from "../plugin-host/protocol";

const logger = createLogger("plugin-isolation");
const REFRESH_MS = 60_000;

export interface PluginIsolationHealth {
  mode: PluginIsolationMode;
  /** 0 when off or the plugin host can't be reached, otherwise 1 to 3. */
  tier: number;
  tierName: string;
  reason: string | null;
  egress: "ready" | "unavailable" | "not-applicable";
  /** Egress proxy decisions since it started, as of the last refresh. */
  egressDecisions: EgressDecisions | null;
}

let health: PluginIsolationHealth = {
  mode: "off",
  tier: 0,
  tierName: "off",
  reason: null,
  egress: "not-applicable",
  egressDecisions: null,
};

export function getPluginIsolationHealth(): PluginIsolationHealth {
  return health;
}

async function refresh(mode: PluginIsolationMode, first: boolean): Promise<void> {
  let status: HostStatus;
  try {
    status = await getPluginHostStatus();
  } catch (error) {
    health = {
      mode,
      tier: 0,
      tierName: "unreachable",
      reason: String(error),
      egress: "unavailable",
      egressDecisions: null,
    };
    logger.error({ err: error }, "Plugin host is unreachable: plugin workers cannot start");
    return;
  }
  // A core that was killed leaves its workers behind; any running core clears them.
  void reapPluginHostWorkers()
    .then((stopped) => {
      if (stopped > 0) logger.warn({ stopped }, "Stopped plugin workers whose core is gone");
    })
    .catch((error: unknown) => logger.warn({ err: error }, "Could not clear orphaned workers"));
  health = {
    mode,
    tier: status.tier,
    tierName: status.tierName,
    reason: status.reason,
    egress: status.egress,
    egressDecisions: status.egressDecisions,
  };
  if (first || status.tier !== 1) {
    const log = status.tier === 1 ? logger.info : logger.error;
    log.call(
      logger,
      { tier: status.tier, tierName: status.tierName, reason: status.reason, mode },
      status.tier === 1
        ? "Plugin workers are sandboxed from each other"
        : "Plugin workers are NOT fully isolated from each other",
    );
  }
}

/**
 * Call once at start-up, before the first worker can start: stops workers an
 * earlier core process left in the plugin host (see reapPluginHostWorkers).
 * A plugin host that is down has none to stop.
 */
export async function reconcilePluginHost(): Promise<void> {
  if (pluginIsolationMode() === "off") return;
  try {
    const stopped = await reapPluginHostWorkers();
    if (stopped > 0) logger.warn({ stopped }, "Stopped plugin workers left by an earlier core");
  } catch (error) {
    logger.warn({ err: error }, "Could not clear the plugin host at start-up");
  }
}

/** Call once at start-up, after the HTTP server is up. */
export async function initPluginIsolation(): Promise<void> {
  const mode = pluginIsolationMode();
  registerCollector(
    "hay_plugin_isolation_tier",
    "Plugin isolation tier: 1 sandbox, 2 separate users, 3 none, 0 isolation off.",
    () => health.tier,
  );
  registerCollector(
    "hay_plugin_egress_decisions_total",
    "Plugin egress proxy decisions since the proxy started, as of the last refresh.",
    () => [
      { labels: { decision: "allowed" }, value: health.egressDecisions?.allowed ?? 0 },
      { labels: { decision: "denied" }, value: health.egressDecisions?.denied ?? 0 },
    ],
    "counter",
  );
  if (mode === "off") {
    logger.warn(
      "PLUGIN_ISOLATION is not set: plugin workers run as child processes of the server, " +
        "with its user, files and network. Plugins are NOT isolated. See SELF_HOSTING.md.",
    );
    return;
  }
  await refresh(mode, true);
  setInterval(() => void refresh(mode, false), REFRESH_MS).unref();
}

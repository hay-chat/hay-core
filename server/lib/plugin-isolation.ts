/**
 * Plugin isolation settings.
 *
 * PLUGIN_ISOLATION decides where plugin workers run:
 * - unset: as child processes of the server, exactly as before. No isolation.
 * - strict | degraded: in the `plugin-host` container, behind its own sandbox
 *   and the egress proxy. They differ only when the host can't sandbox plugins
 *   from each other: `strict` then refuses custom (uploaded) plugins, while
 *   `degraded` runs them anyway. Bundled plugins run in both, with an error log.
 */

export type PluginIsolationMode = "off" | "strict" | "degraded";

export function pluginIsolationMode(env: NodeJS.ProcessEnv = process.env): PluginIsolationMode {
  const value = env.PLUGIN_ISOLATION?.trim().toLowerCase();
  if (!value) return "off";
  if (value === "strict" || value === "degraded") return value;
  throw new Error(`PLUGIN_ISOLATION must be "strict" or "degraded" (or unset), got "${value}"`);
}

/** Unix socket core serves the plugin API on, for workers that have no network. */
export function pluginApiSocketPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.PLUGIN_API_SOCKET?.trim() || undefined;
}

/** Unix socket of the plugin-host supervisor's control API. */
export function pluginHostSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PLUGIN_HOST_SOCKET?.trim() || "/run/hay/control.sock";
}

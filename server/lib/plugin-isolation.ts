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

import path from "path";
import { randomBytes } from "crypto";

export type PluginIsolationMode = "off" | "strict" | "degraded";

export function pluginIsolationMode(env: NodeJS.ProcessEnv = process.env): PluginIsolationMode {
  const value = env.PLUGIN_ISOLATION?.trim().toLowerCase();
  if (!value) return "off";
  if (value === "strict" || value === "degraded") return value;
  throw new Error(`PLUGIN_ISOLATION must be "strict" or "degraded" (or unset), got "${value}"`);
}

/**
 * `PLUGIN_API_SOCKET` names the shared directory (and the plugin host's idea of
 * it): `<dir>/core.sock`. Each core process serves the plugin API on a socket
 * of its own in that directory, so a second core started during a deploy does
 * not take the socket away from the workers of the first.
 */
export function pluginApiSocketDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env.PLUGIN_API_SOCKET?.trim();
  return base ? path.dirname(base) : undefined;
}

let ownSocket: { dir: string; path: string } | undefined;

/** Unix socket this core process serves the plugin API on, for workers that have no network. */
export function ownPluginApiSocketPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = pluginApiSocketDir(env);
  if (!dir) return undefined;
  if (ownSocket?.dir !== dir) {
    ownSocket = { dir, path: path.join(dir, `core-${randomBytes(6).toString("hex")}.sock`) };
  }
  return ownSocket.path;
}

/** Unix socket of the plugin-host supervisor's control API. */
export function pluginHostSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PLUGIN_HOST_SOCKET?.trim() || "/run/hay/ctl/control.sock";
}

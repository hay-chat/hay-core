/**
 * What core and the plugin-host supervisor say to each other, over the
 * supervisor's control socket. Both sides import this file and nothing else
 * from each other, so the supervisor stays free of core's configuration.
 */

/** 1: bubblewrap sandbox. 2: one uid per worker. 3: no isolation between plugins. */
export type IsolationTier = 1 | 2 | 3;

export const TIER_NAMES: Record<IsolationTier, string> = {
  1: "bwrap",
  2: "uid",
  3: "none",
};

export interface StartWorkerRequest {
  /** Handle chosen by core; names the worker's socket directory. */
  id: string;
  pluginId: string;
  orgId: string;
  /** Plugin directory, as seen by both containers. */
  pluginPath: string;
  /** Uploaded rather than shipped with Hay. */
  custom: boolean;
  /** Environment for the worker. The supervisor adds the sockets, proxy and API URL. */
  env: Record<string, string>;
  /** Destinations the worker may reach through the egress proxy (see egress-policy.ts). */
  egressAllow: string[];
}

export interface StartWorkerResponse {
  /** Unix socket the worker's HTTP server listens on. */
  socketPath: string;
  pid: number | null;
}

export interface HostStatus {
  tier: IsolationTier;
  tierName: string;
  /** The exact failure that kept the supervisor from a better tier, or null at tier 1. */
  reason: string | null;
  mode: "strict" | "degraded";
  egress: "ready" | "unavailable";
  workers: number;
}

export type WorkerEvent =
  | { type: "log"; stream: "stdout" | "stderr"; line: string }
  | { type: "exit"; code: number | null; signal: string | null };

export const WORKER_ID_PATTERN = /^[a-z0-9]{1,24}$/;

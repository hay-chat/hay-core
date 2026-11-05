/**
 * Is each platform really connected? One batched answer for the setup board.
 *
 * A plugin that is merely enabled is not connected. For each plugin we ask, in order: the
 * plugin's own `setupStatus`, then whether OAuth finished, then whether tools exist. Every plugin
 * gets its own timeout and failures are isolated, so one slow or broken plugin never stalls
 * `setup.get`. Anything we could not establish is `unknown`, which the board treats as not
 * connected; it is never thrown.
 *
 * @module services/setup/connection
 */

import { pluginManagerService } from "@server/services/plugin-manager.service";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { getCachedToolDescriptors } from "@server/services/plugin-tools.service";
import {
  readPluginSetupStatus,
  type SetupStatus,
} from "@server/services/plugin-setup-status.service";
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("setup-connection");

/** Longest we wait for one plugin before calling it `unknown`. */
export const CONNECTION_TIMEOUT_MS = 3000;

export type ConnectionState = "connected" | "not_connected" | "unknown";

/** What core already knows about a plugin for this organization, without calling the plugin. */
export interface PluginFacts {
  enabled: boolean;
  /** The plugin declares a status handler we can ask. */
  hasStatusHandler: boolean;
  /** The plugin connects through OAuth. */
  usesOAuth: boolean;
  oauthConnected: boolean;
  toolCount: number;
  /** Every required config field has a value (relevant to plugins that connect with a key). */
  requiredConfigPresent: boolean;
}

export interface ConnectionDeps {
  facts: (pluginId: string) => Promise<PluginFacts | null>;
  setupStatus: (pluginId: string) => Promise<Pick<SetupStatus, "state"> | null>;
  timeoutMs: number;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Decides one plugin. Pure given the deps, so every branch is testable. */
export async function resolveOne(pluginId: string, deps: ConnectionDeps): Promise<ConnectionState> {
  const facts = await deps.facts(pluginId);
  if (!facts?.enabled) return "not_connected";

  if (facts.hasStatusHandler) {
    const status = await deps.setupStatus(pluginId);
    if (status) return status.state === "connected" ? "connected" : "not_connected";
  }

  if (facts.usesOAuth) {
    return facts.oauthConnected && facts.toolCount > 0 ? "connected" : "not_connected";
  }
  // Key-based plugins: tools only exist after the worker started with working settings.
  return facts.requiredConfigPresent && facts.toolCount > 0 ? "connected" : "not_connected";
}

/**
 * Connection state for every id. Each id gets its own timeout; a rejection or timeout becomes
 * `unknown` for that plugin only.
 */
export async function resolveConnections(
  pluginIds: string[],
  deps: ConnectionDeps,
): Promise<Map<string, ConnectionState>> {
  const unique = [...new Set(pluginIds)];
  const settled = await Promise.allSettled(
    unique.map((id) => withTimeout(resolveOne(id, deps), deps.timeoutMs)),
  );
  const result = new Map<string, ConnectionState>();
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      result.set(unique[index], outcome.value);
    } else {
      logger.warn({ err: outcome.reason, pluginId: unique[index] }, "Connection state unknown");
      result.set(unique[index], "unknown");
    }
  });
  return result;
}

/** Real dependencies: one instance query for the organization, then in-memory facts. */
export async function defaultDeps(organizationId: string): Promise<ConnectionDeps> {
  const instances = await pluginInstanceRepository.findByOrganization(organizationId);
  const byPlugin = new Map(instances.map((i) => [i.plugin?.pluginId ?? i.pluginId, i]));

  return {
    timeoutMs: CONNECTION_TIMEOUT_MS,
    facts: async (pluginId) => {
      const instance = byPlugin.get(pluginId);
      const plugin = pluginManagerService.getPlugin(pluginId);
      if (!instance || !plugin) return null;

      const metadata = plugin.metadata;
      const schema = (metadata?.configSchema ?? plugin.manifest?.configSchema ?? {}) as Record<
        string,
        ConfigFieldDescriptor
      >;
      const config = (instance.config ?? {}) as Record<string, unknown>;
      const credentials = instance.authState?.credentials ?? {};
      const requiredConfigPresent = Object.entries(schema)
        .filter(([, field]) => field.required)
        .every(([key]) => {
          const value = config[key] ?? credentials[key];
          return value !== undefined && value !== null && value !== "";
        });

      return {
        enabled: instance.enabled,
        hasStatusHandler: !!metadata?.setup?.hasStatus,
        usesOAuth: !!metadata?.authMethods?.some((m: { type: string }) => m.type === "oauth2"),
        oauthConnected: !!instance.authState?.credentials?.accessToken,
        toolCount: getCachedToolDescriptors(instance.config).length,
        requiredConfigPresent,
      };
    },
    setupStatus: (pluginId) => readPluginSetupStatus(organizationId, pluginId),
  };
}

/** Which of `pluginIds` are connected for this organization. Never throws. */
export async function connectedPluginIds(
  organizationId: string,
  pluginIds: string[],
): Promise<Set<string>> {
  if (pluginIds.length === 0) return new Set();
  try {
    const states = await resolveConnections(pluginIds, await defaultDeps(organizationId));
    return new Set([...states].filter(([, state]) => state === "connected").map(([id]) => id));
  } catch (err) {
    logger.warn({ err, organizationId }, "Could not resolve plugin connections");
    return new Set();
  }
}

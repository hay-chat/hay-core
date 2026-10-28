/**
 * Webchat extension point (Core side).
 *
 * Plugins with the `webchat` capability declare, via their SDK metadata:
 *  - contributions: data-only descriptors of a fixed versioned type
 *    (`challenge@1`). Core resolves their config refs per org, validates the
 *    props against the schema it owns for that type, and hands the widget only
 *    the types it advertises in `supports`. The widget renders each type with
 *    its own code — plugin code never reaches the browser.
 *  - gates: synchronous checks Core runs before a widget action. Core wakes the
 *    org's worker, calls `POST /webchat/gate/:event` with a timeout and applies
 *    the plugin's failure policy when the worker is slow or down.
 *
 * Core knows nothing about which plugin provides a contribution or gate.
 */

import { z } from "zod";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginManagerService } from "@server/services/plugin-manager.service";
import { resolveConfigWithEnv, resolveConfigForWorker } from "@server/lib/config-resolver";
import { createLogger } from "@server/lib/logger";
import type { PluginInstance } from "@server/entities/plugin-instance.entity";
import type {
  ConfigFieldDescriptor,
  WebchatContributionDescriptor,
  WebchatGateDescriptor,
  WebchatGateEvent,
  WebchatMetadata,
} from "@server/types/plugin-sdk.types";

const logger = createLogger("webchat-extensions");

/** Contribution types this server can validate and serve. */
export const CONTRIBUTION_TYPES = ["challenge@1"] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

/**
 * `challenge@1`: a bot challenge rendered inside a Hay.chat-hosted frame.
 * `provider` names a challenge provider the challenge page knows how to render;
 * it is part of the type contract, not a plugin id.
 */
export const challengeV1Schema = z.object({
  provider: z.enum(["turnstile"]),
  siteKey: z.string().trim().min(1).max(200),
  mode: z.enum(["off", "invisible", "challenge_all"]),
  action: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,32}$/)
    .default("conversation_create"),
});
export type ChallengeV1Props = z.infer<typeof challengeV1Schema>;

/** A resolved, validated contribution (server-side view; includes the site key). */
export interface ResolvedChallengeContribution {
  /** Stable public id: `<pluginId>.<contributionId>`. */
  id: string;
  type: "challenge@1";
  props: ChallengeV1Props;
}

/** What the widget receives: only what it needs to render. */
export interface PublicContribution {
  id: string;
  type: ContributionType;
  props: { provider: string; mode: "invisible" | "challenge_all" };
}

export interface GateInput {
  token?: string;
  contributionError?: string;
  pageHostname?: string | null;
  frameHostname: string;
  ip?: string;
  underAttack: boolean;
}

export interface GateOutcome {
  decision: "allow" | "deny" | "flag";
  /** Per-plugin results, stored on the conversation for audit. */
  results: Array<{ pluginId: string; decision: "allow" | "deny" | "flag"; reason?: string }>;
}

/** Max time to wait for a cold worker before applying the failure policy. */
const WORKER_START_BUDGET_MS = 8000;
const MAX_GATE_TIMEOUT_MS = 5000;

function webchatMetadata(instance: PluginInstance): WebchatMetadata | undefined {
  return instance.plugin?.metadata?.webchat as WebchatMetadata | undefined;
}

function hasWebchatCapability(instance: PluginInstance): boolean {
  const capabilities = (instance.plugin?.manifest as { capabilities?: unknown } | undefined)
    ?.capabilities;
  return Array.isArray(capabilities) && capabilities.includes("webchat");
}

function configSchemaOf(instance: PluginInstance): Record<string, ConfigFieldDescriptor> {
  return (instance.plugin?.metadata?.configSchema ?? {}) as Record<string, ConfigFieldDescriptor>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolve one contribution's props for an org. Config-backed props are resolved
 * (org value → env → default); encrypted or server-only fields are never
 * resolved into props, since contribution props may be served publicly.
 */
export function resolveContributionProps(
  descriptor: WebchatContributionDescriptor,
  dbConfig: Record<string, unknown> | undefined,
  configSchema: Record<string, ConfigFieldDescriptor>,
): Record<string, unknown> {
  const publicSchema: Record<string, ConfigFieldDescriptor> = {};
  for (const [field, def] of Object.entries(configSchema)) {
    if (!def.encrypted && !def.serverOnly) publicSchema[field] = def;
  }
  const values = resolveConfigWithEnv(dbConfig, publicSchema, { decrypt: false }).values;

  const props: Record<string, unknown> = { ...descriptor.props };
  for (const [prop, field] of Object.entries(descriptor.configProps ?? {})) {
    props[prop] = field in publicSchema ? values[field] : undefined;
  }
  return props;
}

export class WebchatExtensionsService {
  private async webchatInstances(organizationId: string): Promise<PluginInstance[]> {
    const instances = await pluginInstanceRepository.findEnabledByOrganization(organizationId);
    return instances.filter(hasWebchatCapability);
  }

  /**
   * Metadata is plugin-global and cached after a worker first starts. When it is
   * missing or stale, warm it in the background so the next request sees it.
   */
  private refreshMetadataIfNeeded(instance: PluginInstance): void {
    if (instance.plugin?.metadataState === "fresh" && instance.plugin?.metadata) return;
    void pluginManagerService
      .getOrStartWorker(instance.organizationId, instance.plugin.pluginId)
      .catch((error) =>
        logger.warn(
          { err: error, pluginId: instance.plugin.pluginId },
          "Could not warm webchat plugin metadata",
        ),
      );
  }

  /**
   * Resolve every valid `challenge@1` contribution for an org (server-side view).
   * Under-attack mode forces `challenge_all`, even when the owner chose `off`.
   */
  async resolveChallenges(
    organizationId: string,
    options: { underAttack: boolean },
  ): Promise<ResolvedChallengeContribution[]> {
    const resolved: ResolvedChallengeContribution[] = [];
    for (const instance of await this.webchatInstances(organizationId)) {
      this.refreshMetadataIfNeeded(instance);
      const metadata = webchatMetadata(instance);
      for (const descriptor of metadata?.contributions ?? []) {
        if (descriptor.type !== "challenge@1") continue;
        const id = `${instance.plugin.pluginId}.${descriptor.id}`;
        const parsed = challengeV1Schema.safeParse(
          resolveContributionProps(descriptor, instance.config, configSchemaOf(instance)),
        );
        if (!parsed.success) {
          // Typically a missing site key (env unset): the feature is unavailable.
          logger.info(
            { organizationId, contribution: id, issues: parsed.error.issues.map((i) => i.path) },
            "Webchat challenge unavailable: contribution props are incomplete",
          );
          continue;
        }
        const props = { ...parsed.data };
        if (options.underAttack) props.mode = "challenge_all";
        if (props.mode === "off") continue;
        resolved.push({ id, type: "challenge@1", props });
      }
    }
    return resolved;
  }

  /** Public contributions for a widget, filtered to the types it can render. */
  async getPublicContributions(
    organizationId: string,
    supports: readonly string[],
    options: { underAttack: boolean },
  ): Promise<PublicContribution[]> {
    if (!supports.includes("challenge@1")) return [];
    const challenges = await this.resolveChallenges(organizationId, options);
    return challenges.map((c) => ({
      id: c.id,
      type: c.type,
      props: { provider: c.props.provider, mode: c.props.mode as "invisible" | "challenge_all" },
    }));
  }

  /**
   * Run every gate registered for `event` across the org's webchat plugins.
   * Any deny → deny; any flag → flag; otherwise allow. No gates → allow.
   */
  async runGates(
    organizationId: string,
    event: WebchatGateEvent,
    input: GateInput,
  ): Promise<GateOutcome> {
    const results: GateOutcome["results"] = [];

    for (const instance of await this.webchatInstances(organizationId)) {
      this.refreshMetadataIfNeeded(instance);
      const gate = webchatMetadata(instance)?.gates?.find((g) => g.event === event);
      if (!gate) continue;
      results.push(await this.callGate(instance, gate, input));
    }

    const decision = results.some((r) => r.decision === "deny")
      ? "deny"
      : results.some((r) => r.decision === "flag")
        ? "flag"
        : "allow";
    return { decision, results };
  }

  private async callGate(
    instance: PluginInstance,
    gate: WebchatGateDescriptor,
    input: GateInput,
  ): Promise<GateOutcome["results"][number]> {
    const pluginId = instance.plugin.pluginId;
    const timeoutMs = Math.min(Math.max(gate.timeoutMs || 3000, 1), MAX_GATE_TIMEOUT_MS);

    try {
      const worker = await withTimeout(
        pluginManagerService.getOrStartWorker(instance.organizationId, pluginId),
        WORKER_START_BUDGET_MS,
        "Worker start",
      );
      const config = resolveConfigForWorker(
        instance.config,
        instance.authState,
        configSchemaOf(instance),
      );
      const response = await fetch(
        `http://localhost:${worker.port}/webchat/gate/${encodeURIComponent(gate.event)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, input: { ...input, event: gate.event } }),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { decision?: unknown; reason?: unknown };
      if (body.decision !== "allow" && body.decision !== "deny" && body.decision !== "flag") {
        throw new Error("invalid decision");
      }
      return {
        pluginId,
        decision: body.decision,
        ...(typeof body.reason === "string" ? { reason: body.reason.slice(0, 100) } : {}),
      };
    } catch (error) {
      const decision = gate.failurePolicy === "closed" ? "deny" : "flag";
      logger.warn(
        { err: error, pluginId, event: gate.event, decision },
        "Webchat gate unavailable, applying failure policy",
      );
      return { pluginId, decision, reason: "gate_unavailable" };
    }
  }
}

export const webchatExtensionsService = new WebchatExtensionsService();

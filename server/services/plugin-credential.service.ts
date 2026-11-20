/**
 * Hands a plugin worker the secrets it declared, one at a time, when it asks.
 *
 * The worker's spawn environment carries no secrets; it pulls each credential its
 * manifest declares (see lib/plugin-credentials). Core answers only when the
 * credential is declared, the worker's token holds the capability the manifest
 * binds it to, and the plugin is enabled for the token's organization. A
 * connected account's access token is refreshed here, at pull time, so a worker
 * that outlives the token it started with gets a new one. A refresh token is never
 * part of an answer. Every issue is written to the audit log, without the value.
 */
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { createLogger } from "@server/lib/logger";
import { configEnvAllowList } from "@server/lib/plugin-env";
import { resolveConfigWithEnv } from "@server/lib/config-resolver";
import { decryptConfig } from "@server/lib/auth/utils/encryption";
import {
  AUTH_CREDENTIAL,
  isSecretField,
  parseCredentialDeclarations,
  workerAuthCredentials,
} from "@server/lib/plugin-credentials";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { auditLogService } from "@server/services/audit-log.service";
import { oauthService } from "@server/services/oauth.service";
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";

const logger = createLogger("plugin-credentials");

/** Refresh an access token that expires within this many seconds. */
const REFRESH_WINDOW_SECONDS = 5 * 60;

/** After a failed refresh, the provider is not asked again for this long. */
const REFRESH_RETRY_AFTER_MS = 30_000;

export interface IssuedCredential {
  value: unknown;
  /** Epoch seconds after which the worker should pull again, or null when it does not expire. */
  expiresAt: number | null;
  /** True when the access token is about to expire and core could not refresh it. */
  refreshFailed?: boolean;
}

/** Per account, when a failed refresh may be tried again (epoch milliseconds). */
const refreshRetryAt = new Map<string, number>();
/** Per account and credential, a digest of the last value and expiry that were audited. */
const auditedIssues = new Map<string, string>();

function issueDigest(issued: IssuedCredential): string {
  return createHash("sha256")
    .update(JSON.stringify([issued.value, issued.expiresAt]))
    .digest("hex");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function issueCredential(params: {
  organizationId: string;
  pluginId: string;
  /** Capabilities of the worker's token. */
  capabilities: readonly string[];
  name: string;
}): Promise<IssuedCredential> {
  const { organizationId, pluginId, capabilities, name } = params;
  const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
  const declarations = parseCredentialDeclarations(
    (plugin?.manifest as { credentials?: unknown } | undefined)?.credentials,
  );
  const declaration = declarations.find((candidate) => candidate.name === name);
  if (!plugin || !declaration) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Credential '${name}' is not declared` });
  }
  if (!capabilities.includes(declaration.capability)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Credential '${name}' needs the '${declaration.capability}' capability`,
    });
  }

  let instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);
  if (!instance?.enabled) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Plugin is not enabled" });
  }
  const schema = (plugin.metadata?.configSchema ?? {}) as Record<string, ConfigFieldDescriptor>;

  let issued: IssuedCredential;
  let refreshed = false;
  let refreshFailed = false;
  if (declaration.source === "config") {
    // The worker's field list is cached from its first run; until then the
    // manifest alone says this is a secret.
    const field = schema[name];
    if (field && (!isSecretField(field) || field.serverOnly)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `'${name}' is not a secret field` });
    }
    const resolved = field
      ? resolveConfigWithEnv(instance.config, schema, {
          decrypt: true,
          // A value shared by the whole platform is not handed to a worker when
          // the declaration says it must come from the organization's own settings.
          allowedEnv: declaration.allowEnv ? configEnvAllowList(plugin) : new Set<string>(),
        }).values[name]
      : decryptConfig(instance.config ?? {})[name];
    // Plugins with an auth method keep their secret fields in the auth state;
    // the others (and server-managed values) resolve from the config.
    issued = {
      value: instance.authState?.credentials?.[name] ?? resolved ?? null,
      expiresAt: null,
    };
  } else {
    const expiresAt = instance.authState?.credentials?.expiresAt;
    const accountKey = `${organizationId}:${pluginId}`;
    if (
      instance.authMethod === "oauth" &&
      typeof expiresAt === "number" &&
      expiresAt - nowSeconds() < REFRESH_WINDOW_SECONDS
    ) {
      if ((refreshRetryAt.get(accountKey) ?? 0) > Date.now()) {
        refreshFailed = true;
      } else {
        try {
          // Checked again under the account's refresh lock: a pull that was
          // waiting behind another refresh finds the new token and stops there.
          const tokens = await oauthService.refreshToken(organizationId, pluginId, {
            onlyIfExpiringWithinSeconds: REFRESH_WINDOW_SECONDS,
          });
          instance =
            (await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId)) ??
            instance;
          refreshed = tokens !== null;
          refreshRetryAt.delete(accountKey);
        } catch (error) {
          // Hand out what core has; the worker's calls fail the way they would have.
          refreshRetryAt.set(accountKey, Date.now() + REFRESH_RETRY_AFTER_MS);
          refreshFailed = true;
          logger.warn({ err: error, pluginId, organizationId }, "Token refresh on pull failed");
        }
      }
    }
    const credentials = instance.authState?.credentials;
    issued = {
      value: credentials
        ? workerAuthCredentials(
            credentials,
            schema,
            new Set(declarations.filter((d) => d.source === "config").map((d) => d.name)),
          )
        : null,
      expiresAt:
        typeof credentials?.expiresAt === "number" ? (credentials.expiresAt as number) : null,
      ...(refreshFailed ? { refreshFailed: true } : {}),
    };
  }

  // A worker pulls again every minute; only a change is worth a log entry.
  const digest = issueDigest(issued);
  const auditKey = `${organizationId}:${pluginId}:${name}`;
  if (auditedIssues.get(auditKey) === digest) return issued;
  auditedIssues.set(auditKey, digest);

  await auditLogService.record({
    actorType: "plugin",
    organizationId,
    action: "plugin.credential.issue",
    resource: "plugin",
    // Names and bindings only: never the value.
    changes: {
      pluginId,
      credential: name,
      source: declaration.source,
      capability: declaration.capability,
      hosts: declaration.hosts,
      ...(declaration.name === AUTH_CREDENTIAL ? { refreshed } : {}),
    },
  });
  return issued;
}

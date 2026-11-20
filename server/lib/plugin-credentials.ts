/**
 * Credentials a plugin worker pulls from core instead of receiving at spawn.
 *
 * A plugin's manifest (package.json `hay-plugin.credentials`) declares each
 * secret it needs, the capability that needs it and the hosts it is sent to.
 * Core hands a secret out only to a worker whose token carries that
 * capability, and never hands out a refresh token.
 */
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";
import { isKnownPluginCapability } from "@server/lib/plugin-capabilities";

/** The credentials of the plugin's connected account (OAuth tokens, API keys), as one object. */
export const AUTH_CREDENTIAL = "auth";

/** Never leaves core: refreshing happens in core, when a worker pulls the access token. */
export const REFRESH_TOKEN_KEY = "refreshToken";

export type CredentialHost = string | { fromConfig: string; suffix?: string };

export interface CredentialDeclaration {
  /** A secret config field's key, or {@link AUTH_CREDENTIAL}. */
  name: string;
  source: "config" | "auth";
  /** Capability the worker must hold to pull it. */
  capability: string;
  /**
   * Where the credential is sent: entries of the plugin's `network.egress` (a
   * host, or a host taken from a config field). Documentation and audit; the
   * egress rules are what decide where a worker can connect.
   */
  hosts: CredentialHost[];
  /**
   * False when the value must come from the organization's own stored settings:
   * the field's server-wide env fallback is never handed to a worker. Defaults
   * to true.
   */
  allowEnv: boolean;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HOST_PATTERN = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/** Validate `hay-plugin.credentials`; throws a message safe to show the uploader. */
export function parseCredentialDeclarations(raw: unknown): CredentialDeclaration[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("hay-plugin credentials must be a list");
  const seen = new Set<string>();
  return raw.map((entry: unknown) => {
    const item = entry as Record<string, unknown> | null;
    if (typeof item !== "object" || item === null) {
      throw new Error("Each hay-plugin credential must be an object");
    }
    const { name, source, capability, hosts, allowEnv } = item;
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
      throw new Error(`Invalid credential name: ${JSON.stringify(name)}`);
    }
    if (name === REFRESH_TOKEN_KEY) {
      throw new Error("A refresh token is never delivered to a plugin");
    }
    if (seen.has(name)) throw new Error(`Credential declared twice: ${name}`);
    seen.add(name);
    if (source !== "config" && source !== "auth") {
      throw new Error(`Credential ${name}: source must be "config" or "auth"`);
    }
    if ((source === "auth") !== (name === AUTH_CREDENTIAL)) {
      throw new Error(
        `Credential ${name}: only the "${AUTH_CREDENTIAL}" credential has source "auth"`,
      );
    }
    if (typeof capability !== "string" || !isKnownPluginCapability(capability)) {
      throw new Error(`Credential ${name}: unknown capability ${JSON.stringify(capability)}`);
    }
    const hostList = hosts === undefined ? [] : hosts;
    const validHost = (host: unknown): boolean =>
      (typeof host === "string" && HOST_PATTERN.test(host)) ||
      (typeof host === "object" &&
        host !== null &&
        typeof (host as { fromConfig?: unknown }).fromConfig === "string");
    if (!Array.isArray(hostList) || !hostList.every(validHost)) {
      throw new Error(`Credential ${name}: hosts must be a list of host names`);
    }
    if (allowEnv !== undefined && typeof allowEnv !== "boolean") {
      throw new Error(`Credential ${name}: allowEnv must be true or false`);
    }
    return {
      name,
      source,
      capability,
      hosts: hostList as CredentialHost[],
      allowEnv: allowEnv !== false,
    };
  });
}

/** Secret config fields: delivered only by pull. Everything else may travel in the worker's settings. */
export function isSecretField(descriptor: ConfigFieldDescriptor | undefined): boolean {
  return descriptor?.encrypted === true;
}

/**
 * The connected account's credentials as a worker may hold them. Left out: the
 * refresh token, anything flagged `serverOnly` (e.g. an OAuth client secret core
 * uses for token exchange), and secret config fields the plugin did not declare as
 * credentials of their own (plugins with an auth method keep those in the same
 * place, so declaring `auth` must not hand them over).
 */
export function workerAuthCredentials(
  credentials: Record<string, unknown>,
  schema: Record<string, ConfigFieldDescriptor>,
  declaredSecretFields: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(credentials).filter(
      ([key]) =>
        key !== REFRESH_TOKEN_KEY &&
        !schema[key]?.serverOnly &&
        (!isSecretField(schema[key]) || declaredSecretFields.has(key)),
    ),
  );
}

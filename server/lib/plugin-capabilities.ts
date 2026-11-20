/**
 * What a plugin may ask core for.
 *
 * A manifest declares capabilities; the plugin API token carries the declared
 * ones and nothing else; every plugin API procedure names the capability it
 * needs and is refused without it. Keep this list in step with
 * `PluginCapability` in packages/plugin-sdk/types/manifest.ts.
 */

/** Capabilities that only describe what a plugin offers; no plugin API call needs them. */
export const PLUGIN_FEATURE_CAPABILITIES = [
  "routes",
  "config",
  "ui",
  "tickets",
  "cron",
  "webchat",
] as const;

/** Capabilities that gate calls from a plugin to core's plugin API. */
export const PLUGIN_API_CAPABILITIES = [
  "messages",
  "customers",
  "email",
  "privacy",
  "sources",
  "mcp",
  "products",
  "disputes",
  "auth",
  "state",
  "credentials",
] as const;

export type PluginApiCapability = (typeof PLUGIN_API_CAPABILITIES)[number];

const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set<string>([
  ...PLUGIN_FEATURE_CAPABILITIES,
  ...PLUGIN_API_CAPABILITIES,
]);

export function isKnownPluginCapability(value: string): boolean {
  return KNOWN_CAPABILITIES.has(value);
}

/**
 * The capabilities a manifest declares that core recognises, without
 * duplicates. This is the only list a plugin API token is minted from.
 */
export function declaredPluginCapabilities(declared: unknown): string[] {
  if (!Array.isArray(declared)) return [];
  return [
    ...new Set(
      declared.filter(
        (capability): capability is string =>
          typeof capability === "string" && KNOWN_CAPABILITIES.has(capability),
      ),
    ),
  ];
}

/**
 * The capability each plugin API procedure needs. A call is allowed when the
 * token holds at least one of the listed capabilities. The router builds its
 * procedures from this table, so a procedure cannot exist without an entry.
 */
export const PLUGIN_API_PROCEDURE_CAPABILITIES = {
  "messages.receive": ["messages"],
  "messages.send": ["messages"],
  "messages.updateStatus": ["messages"],
  "media.upload": ["messages"],
  // Channels report a revoked connection; other connected-account plugins do too.
  "connection.revoke": ["messages", "auth"],
  "channel.reportHealth": ["messages"],
  "email.sendingDomain": ["email"],
  "email.receivedMessage": ["email"],
  "email.receivedAttachments": ["email"],
  "webhooks.setRoutingKeys": ["messages"],
  "conversations.updateStatusByExternalId": ["messages"],
  "messages.getByConversation": ["messages"],
  "customers.get": ["customers"],
  "customers.findByExternalId": ["customers"],
  "customers.upsert": ["customers"],
  "privacy.eraseCustomer": ["privacy"],
  "privacy.exportCustomer": ["privacy"],
  "sources.register": ["sources"],
  "mcp.registerLocal": ["mcp"],
  "mcp.registerRemote": ["mcp"],
  "credentials.get": ["credentials"],
  "state.get": ["state"],
  "state.set": ["state"],
  "state.delete": ["state"],
  "products.upsertMany": ["products"],
  "products.delete": ["products"],
  "products.prune": ["products"],
  "disputes.report": ["disputes"],
} as const satisfies Record<string, readonly PluginApiCapability[]>;

export type PluginApiProcedureName = keyof typeof PLUGIN_API_PROCEDURE_CAPABILITIES;

/** What the plugin API's REST routes need. `/health` only reports the caller's own identity. */
export const PLUGIN_API_ROUTE_CAPABILITIES = {
  "/send-email": ["email"],
} as const satisfies Record<string, readonly PluginApiCapability[]>;

/**
 * Pure helpers for the plugin settings page (D20). Core never names a plugin:
 * everything here works from what the plugin declares (manifest, config schema,
 * auth methods) and what the server resolved (config metadata).
 */

/** Capabilities the "What it can do" card can describe to a merchant. */
export const DESCRIBED_CAPABILITIES = [
  "messages",
  "customers",
  "mcp",
  "products",
  "disputes",
  "documents",
  "webchat",
] as const;
export type DescribedCapability = (typeof DESCRIBED_CAPABILITIES)[number];

/** Legacy object-shaped manifest capabilities, mapped to the SDK's array names. */
const LEGACY_CAPABILITY_KEYS: Record<string, DescribedCapability> = {
  chat_connector: "messages",
  mcp: "mcp",
  document_importer: "documents",
};

/**
 * Merchant-facing capabilities of a plugin, in a stable order. SDK manifests
 * declare an array (`["mcp", "auth"]`); older manifests an object keyed by
 * capability. Plumbing capabilities (auth, cron, config) are left out.
 */
export function describedCapabilities(capabilities: unknown): DescribedCapability[] {
  let names: string[] = [];
  if (Array.isArray(capabilities)) {
    names = capabilities.filter((name): name is string => typeof name === "string");
  } else if (capabilities && typeof capabilities === "object") {
    names = Object.keys(capabilities)
      .filter((key) => (capabilities as Record<string, unknown>)[key])
      .map((key) => LEGACY_CAPABILITY_KEYS[key] ?? key);
  }
  return DESCRIBED_CAPABILITIES.filter((capability) => names.includes(capability));
}

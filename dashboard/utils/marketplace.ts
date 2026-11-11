/**
 * Pure helpers for the Marketplace. Core never names a plugin: sections come
 * from what each plugin declares (`hay-plugin.marketplaceCategory`) and the
 * capability line from its type and capabilities.
 */

/** Marketplace sections in display order. "other" holds plugins that declare no category. */
export const MARKETPLACE_SECTIONS = [
  "channels",
  "commerce",
  "payments",
  "crm",
  "knowledge",
  "security",
  "other",
] as const;
export type MarketplaceSection = (typeof MARKETPLACE_SECTIONS)[number];

export function sectionOf(plugin: { marketplaceCategory?: string | null }): MarketplaceSection {
  return MARKETPLACE_SECTIONS.find((section) => section === plugin.marketplaceCategory) ?? "other";
}

/** What a plugin adds, in the order the capability line and chips show it. */
export const CAPABILITY_TAGS = [
  "channel",
  "knowledge",
  "tools",
  "catalog",
  "disputes",
  "tickets",
  "webchat",
] as const;
export type CapabilityTag = (typeof CAPABILITY_TAGS)[number];

/** Capability tags of a plugin, from its declared type and capabilities. */
export function capabilityTags(plugin: {
  type?: string[];
  capabilities?: unknown;
}): CapabilityTag[] {
  const types = plugin.type ?? [];
  const capabilities = Array.isArray(plugin.capabilities) ? plugin.capabilities : [];
  const has: Record<CapabilityTag, boolean> = {
    channel: types.includes("channel"),
    knowledge: types.includes("document_importer"),
    tools: capabilities.includes("mcp"),
    catalog: capabilities.includes("products"),
    disputes: capabilities.includes("disputes"),
    tickets: capabilities.includes("tickets"),
    webchat: capabilities.includes("webchat"),
  };
  return CAPABILITY_TAGS.filter((tag) => has[tag]);
}

/** Whether every word of the query appears somewhere in the given texts (case-insensitive). */
export function matchesSearch(texts: string[], query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = texts.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Where the plugin SDK is documented. */
export const PLUGIN_DOCS_URL = "https://hay.chat/docs/technical/plugins/getting-started/";

/** The website's "suggest an integration" form, in the dashboard's language when it exists. */
export function requestIntegrationUrl(locale: string): string {
  return locale.toLowerCase().startsWith("pt")
    ? "https://hay.chat/pt/sugerir-integracao/"
    : "https://hay.chat/suggest-integration/";
}

export function pluginDetailPath(pluginId: string): string {
  return `/integrations/plugins/${encodeURIComponent(pluginId)}`;
}

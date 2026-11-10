/**
 * Links in product recommendations.
 *
 * Every store link the assistant hands out is tagged so the merchant's own
 * analytics (and ours, later) can tell a chat-driven visit from any other:
 * `utm_source=hay`, plus the conversation it came from.
 */

const ATTRIBUTION_PARAMS = {
  utm_source: "hay",
  utm_medium: "chat",
  utm_campaign: "product_recommendation",
} as const;

/** Query parameter carrying the conversation a store visit came from. */
export const CONVERSATION_PARAM = "hay_conversation";

/** The URL when it is http(s), else undefined. */
function parseHttpUrl(url: unknown): URL | undefined {
  if (typeof url !== "string") return undefined;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A store URL tagged with where the visit came from. Anything that is not an
 * http(s) URL comes back undefined, so a bad catalog value never reaches a
 * shopper as a link.
 */
export function withShoppingAttribution(url: unknown, conversationId: string): string | undefined {
  const parsed = parseHttpUrl(url);
  if (!parsed) return undefined;
  for (const [key, value] of Object.entries(ATTRIBUTION_PARAMS)) {
    parsed.searchParams.set(key, value);
  }
  parsed.searchParams.set(CONVERSATION_PARAM, conversationId);
  return parsed.toString();
}

/**
 * A variant's buy link (cart permalink, add-to-cart URL) lives under this key
 * of the variant's `attributes`. Core owns the key: the catalog sync writes it
 * from `CanonicalVariant.buyUrl` and drops whatever an adapter put there.
 */
const BUY_URL_ATTRIBUTE = "buyUrl";

/** The variant attributes to store, with the adapter's buy link (if any). */
export function withBuyUrl(
  attributes: Record<string, unknown> | undefined,
  buyUrl: string | undefined,
): Record<string, unknown> | undefined {
  const { [BUY_URL_ATTRIBUTE]: _adapterValue, ...rest } = attributes ?? {};
  const url = parseHttpUrl(buyUrl)?.toString();
  const stored = url ? { ...rest, [BUY_URL_ATTRIBUTE]: url } : rest;
  return Object.keys(stored).length ? stored : undefined;
}

/** The buy link stored on a variant, if it has one. */
export function variantBuyUrl(attributes: Record<string, unknown> | undefined): string | undefined {
  return parseHttpUrl(attributes?.[BUY_URL_ATTRIBUTE])?.toString();
}

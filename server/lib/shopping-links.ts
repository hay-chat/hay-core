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
 * What an adapter says about buying a variant lives under these keys of the
 * variant's `attributes`. Core owns the keys: the catalog sync writes them
 * from `CanonicalVariant.buyUrl` / `cartItemId` and drops whatever an adapter
 * put there itself.
 */
const BUY_URL_ATTRIBUTE = "buyUrl";
const CART_ITEM_ID_ATTRIBUTE = "cartItemId";

/** A cart item id is put into a request the shopper's browser sends: keep it plain. */
export const CART_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function cartItemIdOf(value: unknown): string | undefined {
  return typeof value === "string" && CART_ITEM_ID_PATTERN.test(value) ? value : undefined;
}

/** The variant attributes to store, with the adapter's buy link and cart item id (if any). */
export function withPurchaseFields(
  attributes: Record<string, unknown> | undefined,
  purchase: { buyUrl?: string; cartItemId?: string },
): Record<string, unknown> | undefined {
  const {
    [BUY_URL_ATTRIBUTE]: _adapterUrl,
    [CART_ITEM_ID_ATTRIBUTE]: _adapterId,
    ...stored
  } = attributes ?? {};
  const buyUrl = parseHttpUrl(purchase.buyUrl)?.toString();
  if (buyUrl) stored[BUY_URL_ATTRIBUTE] = buyUrl;
  const cartItemId = cartItemIdOf(purchase.cartItemId);
  if (cartItemId) stored[CART_ITEM_ID_ATTRIBUTE] = cartItemId;
  return Object.keys(stored).length ? stored : undefined;
}

/** The buy link stored on a variant, if it has one. */
export function variantBuyUrl(attributes: Record<string, unknown> | undefined): string | undefined {
  return parseHttpUrl(attributes?.[BUY_URL_ATTRIBUTE])?.toString();
}

/** The id the store's cart takes for a variant, if the adapter gave one. */
export function variantCartItemId(
  attributes: Record<string, unknown> | undefined,
): string | undefined {
  return cartItemIdOf(attributes?.[CART_ITEM_ID_ATTRIBUTE]);
}

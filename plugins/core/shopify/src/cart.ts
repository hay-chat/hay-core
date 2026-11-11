/**
 * Add to cart from chat product cards (`cart@1`), on the storefront's Ajax
 * Cart API: https://shopify.dev/docs/api/ajax/reference/cart
 *
 * The widget sends these requests from the shopper's browser to the page's own
 * origin, so they only work on a Shopify-hosted theme (the Ajax API does not
 * exist on a headless storefront; there the card keeps its plain buy link).
 */

/**
 * The id `/cart/add.js` takes for a variant: the number at the end of its
 * Admin gid. Only for variants the online store can sell right now: the Ajax
 * API answers 422 for one that is sold out or not on the online store.
 */
export function cartItemId(
  onlineStoreUrl: string | null | undefined,
  variant: { id: string; availableForSale?: boolean },
): string | undefined {
  if (!onlineStoreUrl || variant.availableForSale === false) return undefined;
  return /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(variant.id)?.[1];
}

/**
 * Line item property that marks a cart line as added from a chat. The leading
 * underscore makes it private: Shopify hides it at checkout and shows it on
 * the order in the admin (and in the Admin API as a line item custom attribute).
 */
export const CONVERSATION_PROPERTY = "_hay_conversation";

/** Literal props of the `cart@1` contribution (the `enabled` switch is a config field). */
export const CART_REQUESTS = {
  addPath: "/cart/add.js",
  // The id goes unquoted: every add.js example in Shopify's docs sends a JSON number.
  addBody:
    '{"items":[{"id":{{cartItemId}},"quantity":{{quantity}},' +
    `"properties":{"${CONVERSATION_PROPERTY}":"{{conversationId}}"}}]}`,
  checkoutPath: "/checkout",
} as const;

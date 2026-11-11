/**
 * Add to cart from chat product cards (`cart@1` webchat contribution).
 *
 * The widget sends these requests from the shopper's browser, on the store's
 * own origin and with the shopper's own session, through the WooCommerce Store
 * API (wc/store/v1):
 *
 *  1. GET  /cart           → the `Nonce` response header (sent to guests too).
 *  2. POST /cart/add-item  → `{ id, quantity }` with that `Nonce` request header.
 *     The Store API answers 401 without the nonce on any cart write, unless the
 *     store turned the check off.
 *
 * `id` is the product id of a simple product, or the id of a variation whose
 * attributes are all fixed (see `cartItemId` in ./catalog.ts). It is sent as a
 * number: the route declares it an integer.
 *
 * The paths are config fields, not literals, because they differ per store:
 * WordPress in a subdirectory serves the REST API under `/<dir>/wp-json/`, a
 * store on plain permalinks under `/?rest_route=`, and the checkout page can
 * be any page the merchant chose.
 *
 * Not possible here: tying the cart or the order to the conversation. The
 * add-item route takes only `id`, `quantity` and `variation`; cart item data
 * and order meta need PHP on the store (`woocommerce_store_api_add_to_cart_data`),
 * so `{{conversationId}}` is left out of the body.
 */
import type {
  ConfigFieldDescriptor,
  ConfigFieldReference,
  WebchatContributionOptions,
} from "@hay/plugin-sdk";

export const CART_DEFAULTS = {
  cartAddPath: "/wp-json/wc/store/v1/cart/add-item",
  cartTokenPath: "/wp-json/wc/store/v1/cart",
  checkoutPath: "/checkout/",
} as const;

/** The Store API returns the nonce in this header and expects it back in the same one. */
const NONCE_HEADER = "Nonce";

/**
 * Fired on `document.body` after an add so the page redraws its cart:
 *  - `wc_fragment_refresh`: classic themes. cart-fragments.js re-fetches the
 *    mini-cart fragments (when the theme loads that script, i.e. shows the
 *    cart widget).
 *  - `wc-blocks_added_to_cart`: block pages. The blocks' cart data store
 *    re-fetches the cart (Cart block and whatever else reads that store).
 * Neither handler needs event arguments. The Mini-Cart block on its own listens
 * only for `wc-blocks_store_sync_required` on `window` with a detail payload,
 * which a plain event cannot carry: there the count updates on the next page.
 */
export const CART_AFTER_ADD_EVENTS = "wc_fragment_refresh,wc-blocks_added_to_cart";

export const CART_ADD_BODY = '{"id":{{cartItemId}},"quantity":{{quantity}}}';

export const cartConfigFields: Record<string, ConfigFieldDescriptor> = {
  cartActions: {
    type: "boolean",
    label: "Add to cart from chat",
    description:
      "Show an Add to cart button on the products Hay.chat recommends, when the chat is open " +
      "on your store. The product goes into the shopper's own cart. Turn off to show only the " +
      "link to the product.",
    default: true,
  },
  checkoutPath: {
    type: "string",
    label: "Checkout page path",
    description:
      "Where the Checkout link goes after a product is added. Change it if your checkout page " +
      "is not at /checkout/ (for example /finalizar-compra/ or /shop/checkout/).",
    default: CART_DEFAULTS.checkoutPath,
  },
  cartAddPath: {
    type: "string",
    label: "Cart API path: add item",
    description:
      "Only change this if WordPress is installed in a folder or uses plain permalinks. " +
      "Folder example: /shop/wp-json/wc/store/v1/cart/add-item. " +
      "Plain permalinks: /?rest_route=/wc/store/v1/cart/add-item.",
    default: CART_DEFAULTS.cartAddPath,
  },
  cartTokenPath: {
    type: "string",
    label: "Cart API path: cart",
    description:
      "Only change this together with the path above. " +
      "Folder example: /shop/wp-json/wc/store/v1/cart. " +
      "Plain permalinks: /?rest_route=/wc/store/v1/cart.",
    default: CART_DEFAULTS.cartTokenPath,
  },
};

/** `field` is `ctx.config.field`: props that differ per store are config references. */
export function cartContribution(
  field: (name: string) => ConfigFieldReference,
): WebchatContributionOptions {
  return {
    id: "cart",
    type: "cart@1",
    props: {
      enabled: field("cartActions"),
      addPath: field("cartAddPath"),
      addBody: CART_ADD_BODY,
      checkoutPath: field("checkoutPath"),
      tokenPath: field("cartTokenPath"),
      tokenResponseHeader: NONCE_HEADER,
      tokenRequestHeader: NONCE_HEADER,
      afterAddEvents: CART_AFTER_ADD_EVENTS,
    },
  };
}

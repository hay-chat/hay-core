import type { InjectionKey, Ref } from "vue";
import type { CartContribution, RecommendedProduct, WidgetContribution } from "@/types";

/**
 * Add to cart from a product card (`cart@1` contributions).
 *
 * A store plugin describes its platform's cart requests as data; this file is
 * the only code that sends them. Requests go to the page's own origin, with
 * the shopper's own session, and only when the shopper clicks the button.
 */

/** What the product cards need to add to the cart: provided by the widget root. */
export interface CartContext {
  contributions: WidgetContribution[];
  conversationId: Ref<string | null | undefined>;
}
export const cartContextKey: InjectionKey<CartContext> = Symbol("hay-cart");

const SAME_ORIGIN_PATH = /^\/(?!\/)[^\s\\]*$/;
const CART_ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CONVERSATION_ID = /^[A-Za-z0-9-]{1,64}$/;

const siteOf = (hostname: string) => hostname.replace(/^www\./, "").toLowerCase();

/** Whether the page the widget is on belongs to the site that sells the product. */
function isOnProductSite(product: RecommendedProduct, page: Location): boolean {
  try {
    return siteOf(new URL(product.sourceUrl ?? "").hostname) === siteOf(page.hostname);
  } catch {
    return false;
  }
}

/**
 * The cart contribution to use for a product, or null when the product cannot
 * be added from here: no cart item id, a catalog with no cart contribution, or
 * a page that is not the store (the cart requests would hit the wrong site).
 */
export function cartFor(
  contributions: WidgetContribution[],
  product: RecommendedProduct,
  page: Location = window.location,
): CartContribution | null {
  if (!product.topVariant?.cartItemId || !CART_ITEM_ID.test(product.topVariant.cartItemId)) {
    return null;
  }
  if (!isOnProductSite(product, page)) return null;
  const cart = contributions.find(
    (c): c is CartContribution => c.type === "cart@1" && c.source === product.source,
  );
  return cart && SAME_ORIGIN_PATH.test(cart.props.addPath) ? cart : null;
}

/** Fill a body template. Values are checked plain first, so the JSON keeps its shape. */
function fillBody(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

async function cartToken(cart: CartContribution): Promise<Record<string, string>> {
  const { tokenPath, tokenResponseHeader, tokenRequestHeader } = cart.props;
  if (!tokenPath || !tokenResponseHeader || !tokenRequestHeader) return {};
  if (!SAME_ORIGIN_PATH.test(tokenPath)) throw new Error("Invalid cart token path");
  const response = await fetch(tokenPath, { credentials: "same-origin" });
  const token = response.headers.get(tokenResponseHeader);
  if (!token) throw new Error("The store gave no cart token");
  return { [tokenRequestHeader]: token };
}

/** Add one variant to the store's cart. Throws when the store refuses. */
export async function addToCart(
  cart: CartContribution,
  item: { cartItemId: string; quantity?: number; conversationId?: string | null },
): Promise<void> {
  const quantity = item.quantity ?? 1;
  const conversationId = item.conversationId ?? "";
  if (
    !CART_ITEM_ID.test(item.cartItemId) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    (conversationId && !CONVERSATION_ID.test(conversationId))
  ) {
    throw new Error("Invalid cart item");
  }
  const body = fillBody(cart.props.addBody, {
    cartItemId: item.cartItemId,
    quantity,
    conversationId,
  });
  JSON.parse(body); // a template that does not fill to JSON is never sent

  const response = await fetch(cart.props.addPath, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(await cartToken(cart)),
    },
    body,
  });
  if (!response.ok) throw new Error(`The store refused the cart request (${response.status})`);
}

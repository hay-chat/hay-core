import type { InjectionKey, Ref } from "vue";
import type { WidgetContribution } from "@/types";

/**
 * What the product cards need to add to the store's cart, provided by the
 * widget root. Kept apart from utils/cart.ts so the cart code itself loads
 * with the cards (or with the assistant's first cart action), not with the chat.
 */
export interface CartContext {
  contributions: WidgetContribution[];
  conversationId: Ref<string | null | undefined>;
}
export const cartContextKey: InjectionKey<CartContext> = Symbol("hay-cart");

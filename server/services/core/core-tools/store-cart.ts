/**
 * `add_to_cart` and `go_to_checkout` core tools.
 *
 * Unlike other core tools these do nothing on the server: they resolve what
 * the shopper asked for and hand it to the shopper's own browser, which sends
 * the store's cart request as the shopper (see webchat/store-cart.service and
 * the widget's utils/cart.ts). They are only offered while that browser is on
 * the store and connected.
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import { AppDataSource } from "@server/database/data-source";
import { Product, ProductStatus } from "@server/entities/product.entity";
import { ProductVariant, VariantAvailability } from "@server/entities/product-variant.entity";
import { variantCartItemId } from "@server/lib/shopping-links";
import { pageToolService } from "@server/services/webchat/page-tools.service";
import type { CoreToolDefinition } from "./index";
import { CORE_WRITE_RISK, READ_RISK } from "../tool-risk";

const MAX_QUANTITY = 20;

async function storeCartSource(conversation: Conversation): Promise<string | null> {
  if (conversation.channel !== "web") return null;
  return pageToolService.storeCartSource(conversation.id);
}

const isAvailable = async (conversation: Conversation) => !!(await storeCartSource(conversation));

type BuyableVariant = Pick<ProductVariant, "title" | "selectedOptions" | "availability"> & {
  cartItemId: string;
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The one variant the shopper means. `wanted` are the option values they named
 * ("M", "Blue"); every one must be among the variant's options. Throws with
 * what the model should ask when the choice is not settled: we never pick a
 * size or colour for the shopper.
 */
export function chooseVariant(variants: BuyableVariant[], wanted: string[]): BuyableVariant {
  const inStock = variants.filter((v) => v.availability === VariantAvailability.IN_STOCK);
  if (!inStock.length) throw new Error("This product is sold out.");
  const matching = inStock.filter((variant) =>
    wanted.every((value) => (variant.selectedOptions ?? []).some((o) => same(o.value, value))),
  );
  if (matching.length === 1) return matching[0];
  const choices = (matching.length ? matching : inStock).map((v) => v.title).join("; ");
  throw new Error(
    matching.length
      ? `Ask the customer which one they want before adding. In stock: ${choices}`
      : `No in-stock variant matches ${wanted.join(", ")}. In stock: ${choices}`,
  );
}

export const addToCartTool: CoreToolDefinition = {
  name: "add_to_cart",
  description:
    "Add a product to the customer's cart on the store, in their own browser. Use ONLY when " +
    "the customer asks to add or buy a specific product. `productId` is the `id` of a product " +
    "from recommend_products, or the `product_id` of the product on the customer's current " +
    "page. For a product with sizes, colours or other options, pass the values the customer " +
    "chose in `options`; if they have not chosen, ask them first. Tell the customer it was " +
    "added only when this tool says so.",
  risk: CORE_WRITE_RISK,
  isAvailable,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["productId"],
    properties: {
      productId: { type: "string", format: "uuid" },
      options: {
        type: "array",
        items: { type: "string" },
        maxItems: 5,
        description: 'The option values the customer chose, e.g. ["M", "Blue"].',
      },
      quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY, default: 1 },
    },
  },

  async execute(conversation, args) {
    const source = await storeCartSource(conversation);
    if (!source) throw new Error("The customer is not on the store's site right now.");

    const organizationId = conversation.organization_id;
    const productId = String(args.productId ?? "");
    const wanted = Array.isArray(args.options) ? args.options.map(String) : [];
    const quantity = Math.min(
      Math.max(Math.trunc(Number(args.quantity ?? 1)) || 1, 1),
      MAX_QUANTITY,
    );

    const product = await AppDataSource.getRepository(Product).findOne({
      where: { id: productId, organizationId, source, status: ProductStatus.ACTIVE },
    });
    if (!product) throw new Error("That product is not in this store's catalog.");

    const variants = await AppDataSource.getRepository(ProductVariant).find({
      where: { organizationId, productId: product.id },
      order: { position: "ASC" },
    });
    const buyable = variants.flatMap((variant) => {
      const cartItemId = variantCartItemId(variant.attributes);
      return cartItemId ? [{ ...variant, cartItemId }] : [];
    });
    if (!buyable.length) {
      throw new Error("This product cannot be added from the chat. Share its link instead.");
    }
    const variant = chooseVariant(buyable, wanted);

    await pageToolService.call(
      conversation.id,
      organizationId,
      "add_to_cart",
      { source, cartItemId: variant.cartItemId, quantity },
      undefined,
      true,
    );
    return {
      added: true,
      product: product.title,
      variant: variants.length > 1 ? variant.title : undefined,
      quantity,
      note: "Reported by the customer's browser. The cart is on the store's site.",
    };
  },
};

export const goToCheckoutTool: CoreToolDefinition = {
  name: "go_to_checkout",
  description:
    "Take the customer to the store's checkout page in their browser. Use ONLY when the " +
    "customer says they want to check out or pay now. They complete the payment themselves " +
    "on the store's page; you never pay or place the order for them.",
  risk: READ_RISK,
  isAvailable,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },

  async execute(conversation) {
    const source = await storeCartSource(conversation);
    if (!source) throw new Error("The customer is not on the store's site right now.");
    await pageToolService.call(
      conversation.id,
      conversation.organization_id,
      "go_to_checkout",
      { source },
      undefined,
      true,
    );
    return { navigating: true, note: "The customer's browser is opening the checkout page." };
  },
};

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const storeCartSource = jest.fn<(conversationId: string) => Promise<string | null>>();
const call = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const findProduct = jest.fn<(query: unknown) => Promise<unknown>>();
const findVariants = jest.fn<(query: unknown) => Promise<unknown[]>>();

jest.mock("@server/services/webchat/page-tools.service", () => ({
  pageToolService: {
    storeCartSource: (id: string) => storeCartSource(id),
    call: (...args: unknown[]) => call(...args),
  },
}));
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) =>
      entity.name === "Product" ? { findOne: findProduct } : { find: findVariants },
  },
}));

import type { Conversation } from "@server/database/entities/conversation.entity";
import {
  addToCartTool,
  chooseVariant,
  goToCheckoutTool,
} from "@server/services/core/core-tools/store-cart";
import { VariantAvailability } from "@server/entities/product-variant.entity";

const web = { id: "conv-1", organization_id: "org-1", channel: "web" } as Conversation;

const variant = (title: string, values: string[], inStock = true, cartItemId = title) => ({
  title,
  selectedOptions: values.map((value, i) => ({ name: `option${i}`, value })),
  availability: inStock ? VariantAvailability.IN_STOCK : VariantAvailability.OUT_OF_STOCK,
  cartItemId,
  attributes: { cartItemId },
});

describe("chooseVariant", () => {
  const shirts = [
    variant("S / Blue", ["S", "Blue"]),
    variant("M / Blue", ["M", "Blue"]),
    variant("M / Red", ["M", "Red"], false),
  ];

  it("takes the only variant of a simple product", () => {
    expect(chooseVariant([variant("Default", [])], []).title).toBe("Default");
  });

  it("takes the variant the customer named, whatever the letter case", () => {
    expect(chooseVariant(shirts, ["m", "BLUE"]).title).toBe("M / Blue");
  });

  it("asks instead of picking a size for the customer", () => {
    expect(() => chooseVariant(shirts, [])).toThrow(/Ask the customer.*S \/ Blue; M \/ Blue/);
    expect(() => chooseVariant(shirts, ["Blue"])).toThrow(/Ask the customer/);
  });

  it("says what is in stock when the choice is sold out", () => {
    expect(() => chooseVariant(shirts, ["M", "Red"])).toThrow(/No in-stock variant matches/);
  });
});

describe("add_to_cart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeCartSource.mockResolvedValue("store");
    findProduct.mockResolvedValue({ id: "prod-1", title: "Linen Shirt" });
    findVariants.mockResolvedValue([variant("Default", [], true, "44")]);
    call.mockResolvedValue("Added to the cart.");
  });

  it("is offered only while the customer's browser is on the store", async () => {
    expect(await addToCartTool.isAvailable?.(web)).toBe(true);
    expect(await goToCheckoutTool.isAvailable?.(web)).toBe(true);
    storeCartSource.mockResolvedValue(null);
    expect(await addToCartTool.isAvailable?.(web)).toBe(false);
    expect(await addToCartTool.isAvailable?.({ ...web, channel: "whatsapp" } as Conversation)).toBe(
      false,
    );
  });

  it("sends the resolved cart item to the customer's browser", async () => {
    const result = await addToCartTool.execute(web, { productId: "prod-1", quantity: 2 });

    expect(findProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", source: "store" }),
      }),
    );
    expect(call).toHaveBeenCalledWith(
      "conv-1",
      "org-1",
      "add_to_cart",
      { source: "store", cartItemId: "44", quantity: 2 },
      undefined,
      true,
    );
    expect(result).toMatchObject({ added: true, product: "Linen Shirt", quantity: 2 });
  });

  it("refuses a product that is not in the store's catalog", async () => {
    findProduct.mockResolvedValue(null);
    await expect(addToCartTool.execute(web, { productId: "prod-9" })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it("does not claim an add the browser did not make", async () => {
    call.mockRejectedValue(new Error("The store refused the cart request (422)"));
    await expect(addToCartTool.execute(web, { productId: "prod-1" })).rejects.toThrow("422");
  });

  it("refuses when the customer has left the store", async () => {
    storeCartSource.mockResolvedValue(null);
    await expect(addToCartTool.execute(web, { productId: "prod-1" })).rejects.toThrow();
    await expect(goToCheckoutTool.execute(web, {})).rejects.toThrow();
  });
});

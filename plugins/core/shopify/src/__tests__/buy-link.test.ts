import { describe, expect, it } from "vitest";
import { cartPermalink } from "../buy-link.js";

describe("cartPermalink", () => {
  it("builds the cart permalink on the storefront's domain", () => {
    expect(
      cartPermalink(
        "https://shop.example.com/products/blue-shoe",
        "gid://shopify/ProductVariant/4455",
      ),
    ).toBe("https://shop.example.com/cart/4455:1");
  });

  it("has no link for a product that is not on the online store", () => {
    expect(cartPermalink(null, "gid://shopify/ProductVariant/4455")).toBeUndefined();
  });

  it("has no link for an id that is not a variant", () => {
    expect(
      cartPermalink("https://shop.example.com/products/x", "gid://shopify/Product/1::default"),
    ).toBeUndefined();
  });
});

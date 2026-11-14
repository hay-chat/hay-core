import { describe, it, expect } from "@jest/globals";
import { renderProductList } from "@server/lib/channel-rendering";

describe("renderProductList", () => {
  it("lists the product page, and the buy link when there is one", () => {
    const text = renderProductList(
      [
        {
          title: "Linen Shirt",
          sourceUrl: "https://shop.test/product/linen-shirt",
          topVariant: { price: "40.00", currency: "USD", buyUrl: "https://shop.test/cart/44:1" },
        },
        {
          title: "Wool Coat",
          sourceUrl: "https://shop.test/product/wool-coat",
          topVariant: { price: "120.00", currency: "USD" },
        },
      ],
      "en",
    );
    expect(text).toBe(
      "• Linen Shirt · $40.00\nhttps://shop.test/product/linen-shirt\n🛒 https://shop.test/cart/44:1" +
        "\n\n• Wool Coat · $120.00\nhttps://shop.test/product/wool-coat",
    );
  });

  it("never prints a link that is not http(s)", () => {
    const text = renderProductList(
      [{ title: "Shirt", sourceUrl: "javascript:x", topVariant: { buyUrl: "ftp://x" } }],
      "en",
    );
    expect(text).toBe("• Shirt");
  });
});

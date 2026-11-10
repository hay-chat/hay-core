import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import ProductCards from "../ProductCards.vue";
import { provideI18n } from "@/i18n";
import type { RecommendedProduct } from "@/types";

const shirt: RecommendedProduct = {
  id: "p1",
  title: "Linen Shirt",
  sourceUrl: "https://shop.test/product/linen-shirt?utm_source=hay",
  available: true,
  topVariant: {
    price: "40.00",
    compareAtPrice: "50.00",
    currency: "USD",
    buyUrl: "https://shop.test/cart/44:1",
  },
};

const coat: RecommendedProduct = {
  id: "p2",
  title: "Wool Coat",
  sourceUrl: "https://shop.test/product/wool-coat",
  available: true,
  options: [{ name: "Size", values: ["S", "M", "L"] }],
  topVariant: { price: "120.00", compareAtPrice: "120.00", currency: "USD" },
};

function mountCards(products: RecommendedProduct[]) {
  const clicks: unknown[][] = [];
  const Root = defineComponent({
    setup() {
      provideI18n();
      return () =>
        h(ProductCards, { products, onProductClick: (...args: unknown[]) => clicks.push(args) });
    },
  });
  return { wrapper: mount(Root), clicks };
}

describe("ProductCards", () => {
  it("shows the old price struck through only when the product is discounted", () => {
    const cards = mountCards([shirt, coat]).wrapper.findAll(".hay-product-card");
    expect(cards[0].find(".hay-product-card__compare").text()).toContain("50");
    expect(cards[1].find(".hay-product-card__compare").exists()).toBe(false);
  });

  it("lists what the shopper can choose", () => {
    const cards = mountCards([coat]).wrapper;
    expect(cards.find(".hay-product-card__option").text()).toBe("Size: S, M, L");
  });

  it("offers a buy link only when the product has one", () => {
    const cards = mountCards([shirt, coat]).wrapper.findAll(".hay-product-card");
    expect(cards[0].find(".hay-product-card__buy").attributes("href")).toBe(
      "https://shop.test/cart/44:1",
    );
    expect(cards[1].find(".hay-product-card__buy").exists()).toBe(false);
  });

  it("reports which product was opened and which was bought", async () => {
    const { wrapper, clicks } = mountCards([shirt]);
    await wrapper.find(".hay-product-card__link").trigger("click");
    await wrapper.find(".hay-product-card__buy").trigger("click");
    expect(clicks).toEqual([
      ["p1", "card_click"],
      ["p1", "buy_click"],
    ]);
  });

  it("never links to a URL that is not http(s)", () => {
    const { wrapper } = mountCards([
      { ...shirt, sourceUrl: "javascript:alert(1)", topVariant: { buyUrl: "javascript:x" } },
    ]);
    expect(wrapper.find(".hay-product-card__link").attributes("href")).toBe("#");
    expect(wrapper.find(".hay-product-card__buy").exists()).toBe(false);
  });
});

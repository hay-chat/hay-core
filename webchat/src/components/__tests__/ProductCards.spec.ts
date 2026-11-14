import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, provide, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { cartContextKey } from "@/utils/cartContext";
import type { CartContribution } from "@/types";
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

function mountCards(products: RecommendedProduct[], cart?: CartContribution) {
  const clicks: unknown[][] = [];
  const Root = defineComponent({
    setup() {
      provideI18n();
      if (cart) {
        provide(cartContextKey, { contributions: [cart], conversationId: ref("conv-1") });
      }
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

describe("ProductCards: add to cart in the page", () => {
  afterEach(() => vi.unstubAllGlobals());

  // jsdom serves the tests from localhost, so that is "the store" here.
  const inStore: RecommendedProduct = {
    ...shirt,
    source: "store",
    sourceUrl: "http://localhost/product/linen-shirt",
    topVariant: { ...shirt.topVariant, cartItemId: "44" },
  };
  const cart: CartContribution = {
    id: "store.cart",
    type: "cart@1",
    source: "store",
    props: {
      addPath: "/cart/add.js",
      addBody: '{"id":{{cartItemId}},"quantity":{{quantity}}}',
      checkoutPath: "/checkout",
    },
  };

  it("adds the product to the store's cart and then offers checkout", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper, clicks } = mountCards([inStore], cart);

    await wrapper.find("button.hay-product-card__buy").trigger("click");
    await flushPromises();

    expect(fetchMock.mock.calls[0][0]).toBe("/cart/add.js");
    expect(wrapper.find("a.hay-product-card__buy").attributes("href")).toBe("/checkout");
    expect(wrapper.find(".hay-product-card__added").exists()).toBe(true);
    expect(clicks).toEqual([["p1", "cart_add"]]);
  });

  it("falls back to the buy link when the store refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { wrapper, clicks } = mountCards([inStore], cart);

    await wrapper.find("button.hay-product-card__buy").trigger("click");
    await flushPromises();

    expect(wrapper.find("a.hay-product-card__buy").attributes("href")).toBe(
      "https://shop.test/cart/44:1",
    );
    expect(clicks).toEqual([]);
  });

  it("keeps the plain buy link on a page that is not the store", () => {
    const elsewhere = { ...inStore, sourceUrl: "https://shop.test/product/linen-shirt" };
    const { wrapper } = mountCards([elsewhere], cart);
    expect(wrapper.find("button.hay-product-card__buy").exists()).toBe(false);
    expect(wrapper.find("a.hay-product-card__buy").exists()).toBe(true);
  });
});

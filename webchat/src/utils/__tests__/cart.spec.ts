import { describe, it, expect, vi, afterEach } from "vitest";
import { addToCart, cartFor } from "../cart";
import type { CartContribution, RecommendedProduct } from "@/types";

const cart: CartContribution = {
  id: "store.cart",
  type: "cart@1",
  source: "store",
  props: {
    addPath: "/cart/add.js",
    addBody: '{"items":[{"id":{{cartItemId}},"quantity":{{quantity}},"ref":"{{conversationId}}"}]}',
    checkoutPath: "/checkout",
  },
};

const product: RecommendedProduct = {
  id: "p1",
  source: "store",
  title: "Linen Shirt",
  sourceUrl: "https://www.shop.test/products/linen-shirt",
  topVariant: { cartItemId: "44" },
};

const page = (hostname: string) => ({ hostname }) as Location;

describe("cartFor", () => {
  it("offers the cart of the product's own catalog, on the store's site", () => {
    expect(cartFor([cart], product, page("shop.test"))).toBe(cart);
  });

  it("offers nothing on a page that is not the store", () => {
    expect(cartFor([cart], product, page("blog.example"))).toBeNull();
  });

  it("offers nothing for a product of another catalog", () => {
    expect(cartFor([cart], { ...product, source: "other" }, page("shop.test"))).toBeNull();
  });

  it("offers nothing when the variant cannot be added on its own", () => {
    expect(cartFor([cart], { ...product, topVariant: {} }, page("shop.test"))).toBeNull();
  });

  it("refuses a contribution that points at another host", () => {
    const elsewhere = { ...cart, props: { ...cart.props, addPath: "//evil.test/cart" } };
    expect(cartFor([elsewhere], product, page("shop.test"))).toBeNull();
  });
});

describe("addToCart", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the filled body to the store", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await addToCart(cart, { cartItemId: "44", conversationId: "0b0f6a0e-1c1c" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/cart/add.js");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      items: [{ id: 44, quantity: 1, ref: "0b0f6a0e-1c1c" }],
    });
  });

  it("fetches the store's token first when the store wants one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ headers: new Headers({ Nonce: "abc" }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const withToken = {
      ...cart,
      props: {
        ...cart.props,
        tokenPath: "/api/cart",
        tokenResponseHeader: "Nonce",
        tokenRequestHeader: "Nonce",
      },
    };

    await addToCart(withToken, { cartItemId: "44" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/cart");
    expect(fetchMock.mock.calls[1][1].headers.Nonce).toBe("abc");
  });

  it("never sends an id that could change the request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(addToCart(cart, { cartItemId: '1,"quantity":99' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the store refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    await expect(addToCart(cart, { cartItemId: "44" })).rejects.toThrow("422");
  });
});

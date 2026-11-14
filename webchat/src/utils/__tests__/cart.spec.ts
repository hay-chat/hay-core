import { describe, it, expect, vi, afterEach } from "vitest";
import { addToCart, cartFor, runStoreAction, storePath } from "../cart";
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

describe("after an add", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells the page its cart changed, with the plugin's events and ours", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const heard: string[] = [];
    document.addEventListener("theme:refresh", () => heard.push("theme:refresh"), { once: true });
    document.addEventListener("hay:cart-updated", () => heard.push("hay:cart-updated"), {
      once: true,
    });
    window.addEventListener(
      "store:sync",
      (event) => heard.push(`store:sync ${(event as CustomEvent).detail.type}`),
      { once: true },
    );

    const withEvents = {
      ...cart,
      props: {
        ...cart.props,
        afterAddEvents: JSON.stringify([
          { name: "theme:refresh" },
          { name: "store:sync", target: "window", detail: { type: "from_data" } },
          { name: "bad name" },
        ]),
      },
    };
    await addToCart(withEvents, { cartItemId: "44" });

    expect(heard).toEqual(["theme:refresh", "store:sync from_data", "hay:cart-updated"]);
  });

  it("still fires its own event when the plugin's list is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const listener = vi.fn();
    document.addEventListener("hay:cart-updated", listener, { once: true });
    await addToCart(
      { ...cart, props: { ...cart.props, afterAddEvents: "a,b" } },
      { cartItemId: "44" },
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the store refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const listener = vi.fn();
    document.addEventListener("hay:cart-updated", listener, { once: true });
    await expect(addToCart(cart, { cartItemId: "44" })).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
    document.removeEventListener("hay:cart-updated", listener);
  });
});

describe("runStoreAction (what the assistant asks this browser to do)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("adds what the server resolved to the store's cart", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const answer = await runStoreAction(
      [cart],
      "add_to_cart",
      { source: "store", cartItemId: "44", quantity: 2 },
      "conv-1",
    );

    expect(answer).toBe("Added to the cart.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).items[0]).toMatchObject({
      id: 44,
      quantity: 2,
    });
  });

  it("answers before it opens the checkout", async () => {
    vi.useFakeTimers();
    const page = { assign: vi.fn() } as unknown as Location;

    const answer = await runStoreAction([cart], "go_to_checkout", { source: "store" }, null, page);

    expect(answer).toBe("Opening the checkout page.");
    expect(page.assign).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(page.assign).toHaveBeenCalledWith("/checkout");
  });

  it("refuses a cart this page does not have", async () => {
    await expect(
      runStoreAction([cart], "add_to_cart", { source: "other", cartItemId: "44" }, null),
    ).rejects.toThrow();
  });
});

describe("storePath (stores served from a locale folder)", () => {
  const localized = { ...cart, props: { ...cart.props, rootPathGlobal: "Store.routes.root" } };
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).Store;
    vi.unstubAllGlobals();
  });

  it("puts the storefront's root in front of the cart paths", async () => {
    (window as unknown as Record<string, unknown>).Store = { routes: { root: "/en-ca/" } };
    expect(storePath(localized, "/cart/add.js")).toBe("/en-ca/cart/add.js");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await addToCart(localized, { cartItemId: "44" });
    expect(fetchMock.mock.calls[0][0]).toBe("/en-ca/cart/add.js");
  });

  it("uses the path as declared when the store is at the root or says nothing", () => {
    expect(storePath(localized, "/checkout")).toBe("/checkout");
    (window as unknown as Record<string, unknown>).Store = { routes: { root: "/" } };
    expect(storePath(localized, "/checkout")).toBe("/checkout");
    expect(storePath(cart, "/checkout")).toBe("/checkout");
  });

  it("ignores a root that points at another site", () => {
    (window as unknown as Record<string, unknown>).Store = { routes: { root: "//evil.test/" } };
    expect(storePath(localized, "/checkout")).toBe("/checkout");
    (window as unknown as Record<string, unknown>).Store = {
      routes: { root: "https://evil.test/" },
    };
    expect(storePath(localized, "/checkout")).toBe("/checkout");
  });
});

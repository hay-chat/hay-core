import { describe, it, expect } from "vitest";
import type { CanonicalProduct } from "@hay/plugin-sdk";
import { bulkSync, mapProduct, type WooGet, type WooProduct, type WooVariation } from "./catalog";

// Shapes as wc/v3 returns them (trimmed to the fields the sync reads).
const SIMPLE: WooProduct = {
  id: 10,
  name: "Linen Shirt",
  slug: "linen-shirt",
  permalink: "https://shop.test/product/linen-shirt/",
  type: "simple",
  status: "publish",
  catalog_visibility: "visible",
  description: "<p>Soft linen.</p>",
  short_description: "<p>Linen.</p>",
  sku: "LS-1",
  price: "40.00",
  regular_price: "50.00",
  sale_price: "40.00",
  manage_stock: true,
  stock_quantity: 3,
  stock_status: "instock",
  categories: [{ id: 5, name: "Shirts", slug: "shirts" }],
  tags: [{ name: "summer" }],
  images: [{ src: "https://shop.test/ls.jpg", alt: "Linen shirt" }],
  attributes: [],
  variations: [],
};

const VARIABLE: WooProduct = {
  id: 20,
  name: "Hoodie",
  slug: "hoodie",
  type: "variable",
  status: "publish",
  catalog_visibility: "visible",
  price: "30.00",
  regular_price: "",
  stock_status: "instock",
  attributes: [{ name: "Size", position: 0, variation: true, options: ["S", "M"] }],
  variations: [21, 22],
};

const VARIATIONS: WooVariation[] = [
  {
    id: 21,
    sku: "HD-S",
    price: "30.00",
    regular_price: "30.00",
    manage_stock: false,
    stock_status: "outofstock",
    attributes: [{ name: "Size", option: "S" }],
    image: { src: "https://shop.test/hd-s.jpg" },
    menu_order: 1,
    status: "publish",
  },
  {
    id: 22,
    sku: "HD-M",
    price: "32.00",
    regular_price: "32.00",
    manage_stock: "parent",
    stock_quantity: 7,
    stock_status: "onbackorder",
    attributes: [{ name: "Size", option: "M" }],
    menu_order: 2,
    status: "publish",
  },
];

describe("mapProduct", () => {
  it("maps a simple product to one default variant with sale pricing", () => {
    const p = mapProduct(SIMPLE, [], "BRL");
    expect(p).toMatchObject({
      externalId: "10",
      handle: "linen-shirt",
      title: "Linen Shirt",
      status: "active",
      tags: ["summer"],
      categories: [{ externalId: "5", name: "Shirts", slug: "shirts" }],
      sourceUrl: "https://shop.test/product/linen-shirt/",
      currency: "BRL",
    });
    expect(p.variants).toEqual([
      expect.objectContaining({
        externalId: "10::default",
        sku: "LS-1",
        price: 40,
        compareAtPrice: 50,
        inventoryQuantity: 3,
        inventoryTracked: true,
        availability: "in_stock",
        imageSrc: "https://shop.test/ls.jpg",
      }),
    ]);
  });

  it("maps variations with their options, stock status and images", () => {
    const p = mapProduct(VARIABLE, VARIATIONS, undefined);
    expect(p.options).toEqual([{ name: "Size", position: 0, values: ["S", "M"] }]);
    expect(p.variants.map((v) => [v.externalId, v.title, v.price, v.availability])).toEqual([
      ["21", "S", 30, "out_of_stock"],
      ["22", "M", 32, "backorder"],
    ]);
    expect(p.variants[0].inventoryTracked).toBe(false);
    expect(p.variants[1]).toMatchObject({ inventoryTracked: true, inventoryQuantity: 7 });
    expect(p.variants[0].compareAtPrice).toBeUndefined();
  });

  it("syncs drafts, private and catalogue-hidden products as draft", () => {
    expect(mapProduct({ ...SIMPLE, status: "draft" }, [], undefined).status).toBe("draft");
    expect(mapProduct({ ...SIMPLE, status: "private" }, [], undefined).status).toBe("draft");
    expect(mapProduct({ ...SIMPLE, catalog_visibility: "hidden" }, [], undefined).status).toBe(
      "draft",
    );
  });
});

describe("bulkSync", () => {
  it("pages products, fetches variations of variable products and upserts each page", async () => {
    const requested: string[] = [];
    const wooGet: WooGet = async <T>(path: string) => {
      requested.push(path);
      if (path === "/data/currencies/current") return { data: { code: "USD" } as T, totalPages: 1 };
      if (path.startsWith("/products?") && path.includes("page=1&"))
        return { data: [SIMPLE, VARIABLE] as T, totalPages: 2 };
      if (path.startsWith("/products?") && path.includes("page=2&"))
        return { data: [{ ...SIMPLE, id: 11, slug: "other" }] as T, totalPages: 2 };
      if (path.startsWith("/products/20/variations"))
        return { data: VARIATIONS as T, totalPages: 1 };
      throw new Error(`unexpected ${path}`);
    };
    const batches: CanonicalProduct[][] = [];
    const productSource = {
      upsert: async (products: CanonicalProduct[]) => {
        batches.push(products);
        return { upserted: products.length, errors: 0 };
      },
      delete: async () => ({ removed: false }),
    };

    const { total } = await bulkSync(wooGet, productSource, { info: () => {} });

    expect(total).toBe(3);
    expect(batches.map((b) => b.map((p) => p.externalId))).toEqual([["10", "20"], ["11"]]);
    expect(batches[0][1].variants).toHaveLength(2);
    expect(batches[0][0].currency).toBe("USD");
    // Simple products never trigger a variations call.
    expect(requested.filter((p) => p.includes("/variations"))).toEqual([
      "/products/20/variations?per_page=100&page=1",
    ]);
  });

  it("still syncs when the key cannot read the store currency", async () => {
    const wooGet: WooGet = async <T>(path: string) => {
      if (path === "/data/currencies/current") throw new Error("HTTP 401");
      return { data: [SIMPLE] as T, totalPages: 1 };
    };
    const seen: CanonicalProduct[] = [];
    await bulkSync(
      wooGet,
      {
        upsert: async (p) => (seen.push(...p), { upserted: p.length, errors: 0 }),
        delete: async () => ({ removed: false }),
      },
      { info: () => {} },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].currency).toBeUndefined();
  });
});

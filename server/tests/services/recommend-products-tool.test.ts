import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * recommend_products: hybrid retrieval (vector + keyword, fused by rank) and
 * variant option filters. The database and both searches are mocked; the
 * ranking and matching rules themselves are covered in tests/lib.
 */

const mockWarn = jest.fn();
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: mockWarn, error: jest.fn() }),
}));

const mockVectorSearch =
  jest.fn<(org: string, query: string, k: number, alsoScore: string[]) => Promise<unknown[]>>();
jest.mock("@server/services/product-vector-store.service", () => ({
  productVectorStoreService: {
    initialized: true,
    search: (org: string, query: string, k: number, alsoScore: string[]) =>
      mockVectorSearch(org, query, k, alsoScore),
  },
}));

const mockKeywordSearch = jest.fn<(org: string, query: string, k: number) => Promise<string[]>>();
jest.mock("@server/services/product-keyword-search.service", () => ({
  productKeywordSearchService: {
    search: (org: string, query: string, k: number) => mockKeywordSearch(org, query, k),
  },
}));

let products: Array<Record<string, unknown>> = [];
let variants: Array<Record<string, unknown>> = [];
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) => ({
      find: async () => (entity.name === "Product" ? products : variants),
    }),
  },
}));

import { recommendProductsTool } from "@server/services/core/core-tools/recommend-products";
import type { Conversation } from "@server/database/entities/conversation.entity";

const conversation = { id: "conv-1", organization_id: "org-1" } as unknown as Conversation;

const product = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  externalId: `ext-${id}`,
  source: "custom",
  title: id,
  handle: id,
  available: true,
  tags: [],
  sourceUrl: `https://shop.test/products/${id}`,
  ...extra,
});

const variant = (
  id: string,
  productId: string,
  options: Record<string, string>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  productId,
  externalId: `ext-${id}`,
  title: Object.values(options).join(" / "),
  price: "20.00",
  availability: "in_stock",
  selectedOptions: Object.entries(options).map(([name, value]) => ({ name, value })),
  attributes: { buyUrl: `https://shop.test/cart/${id}:1`, cartItemId: `cart-${id}` },
  ...extra,
});

const hit = (productId: string, similarity: number) => ({ productId, similarity });

interface ToolResult {
  products: Array<{
    id: string;
    similarity: number;
    matchingVariantCount?: number;
    topVariant?: {
      id: string;
      externalId: string;
      buyUrl?: string;
      cartItemId?: string;
      selectedOptions?: unknown;
    };
  }>;
  filtersApplied: Record<string, unknown>;
}

const run = (args: Record<string, unknown>) =>
  recommendProductsTool.execute(conversation, args) as Promise<ToolResult>;

beforeEach(() => {
  jest.clearAllMocks();
  products = [];
  variants = [];
});

describe("recommend_products hybrid retrieval", () => {
  it("lifts a keyword match the vector search ranked low", async () => {
    products = [product("bose"), product("runner"), product("sony")];
    variants = [variant("v1", "bose", {}), variant("v2", "runner", {}), variant("v3", "sony", {})];
    mockKeywordSearch.mockResolvedValue(["sony"]);
    mockVectorSearch.mockResolvedValue([hit("bose", 0.6), hit("runner", 0.5), hit("sony", 0.4)]);

    const result = await run({ query: "Sony WH-1000XM5" });

    expect(result.products.map((p) => p.id)).toEqual(["sony", "bose", "runner"]);
    expect(result.products[0].similarity).toBe(0.4);
  });

  it("returns a product only the keyword search found, with its real similarity", async () => {
    products = [product("bose"), product("runner")];
    variants = [variant("v1", "bose", {}), variant("v2", "runner", {})];
    mockKeywordSearch.mockResolvedValue(["runner"]);
    // The vector store scores the keyword ids it did not find itself, after its own top k.
    mockVectorSearch.mockImplementation(async (_org, _query, k, alsoScore) => {
      expect(alsoScore).toEqual(["runner"]);
      return [...Array.from({ length: k }, (_, i) => hit(`other-${i}`, 0.9)), hit("runner", 0.2)];
    });

    const result = await run({ query: "TR2-BLK-42" });

    expect(result.products.map((p) => p.id)).toEqual(["runner"]);
    expect(result.products[0].similarity).toBe(0.2);
  });

  it("falls back to vector-only when the keyword search fails", async () => {
    products = [product("bose"), product("sony")];
    variants = [variant("v1", "bose", {}), variant("v3", "sony", {})];
    mockKeywordSearch.mockRejectedValue(new Error('column "search_vector" does not exist'));
    mockVectorSearch.mockResolvedValue([hit("bose", 0.6), hit("sony", 0.4)]);

    const result = await run({ query: "headphones" });

    expect(result.products.map((p) => p.id)).toEqual(["bose", "sony"]);
    expect(mockVectorSearch).toHaveBeenCalledWith("org-1", "headphones", 20, []);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when neither search finds anything", async () => {
    mockKeywordSearch.mockResolvedValue([]);
    mockVectorSearch.mockResolvedValue([]);
    expect((await run({ query: "zzz" })).products).toEqual([]);
  });
});

describe("recommend_products option filters", () => {
  const sizeM = { options: [{ name: "size", value: "M" }] };

  beforeEach(() => {
    mockKeywordSearch.mockResolvedValue([]);
    mockVectorSearch.mockResolvedValue([hit("oxford", 0.7), hit("linen", 0.6)]);
    products = [product("oxford"), product("linen")];
  });

  it("returns the matching variant with a buy link, on a multi-variant product", async () => {
    variants = [
      variant("ox-s", "oxford", { Size: "S" }, { price: "10.00" }),
      variant("ox-m", "oxford", { Size: "M" }, { price: "30.00" }),
      variant("li-m", "linen", { Tamanho: "M" }),
      variant("li-l", "linen", { Tamanho: "L" }),
    ];

    const result = await run({ query: "shirt", filters: sizeM });

    expect(result.products.map((p) => p.topVariant?.id)).toEqual(["ox-m", "li-m"]);
    const top = result.products[0].topVariant;
    expect(top?.externalId).toBe("ext-ox-m");
    expect(top?.selectedOptions).toEqual([{ name: "Size", value: "M" }]);
    expect(new URL(top?.buyUrl as string).pathname).toBe("/cart/ox-m:1");
    expect(top?.cartItemId).toBe("cart-ox-m");
    expect(result.products[0].matchingVariantCount).toBe(1);
    expect(result.filtersApplied.options).toEqual(sizeM.options);
  });

  it("drops a product whose matching variant is sold out though the product is available", async () => {
    variants = [
      variant("ox-m", "oxford", { Size: "M" }, { availability: "out_of_stock" }),
      variant("ox-xl", "oxford", { Size: "XL" }),
      variant("li-m", "linen", { Size: "M" }),
    ];

    const result = await run({ query: "shirt", filters: sizeM });
    expect(result.products.map((p) => p.id)).toEqual(["linen"]);

    const anyStock = await run({ query: "shirt", filters: { ...sizeM, inStockOnly: false } });
    expect(anyStock.products.map((p) => p.id)).toEqual(["oxford", "linen"]);
    expect(anyStock.products[0].topVariant?.id).toBe("ox-m");
    expect(anyStock.products[0].topVariant?.buyUrl).toBeUndefined();
  });

  it("offers no buy link while more than one variant fits", async () => {
    variants = [
      variant("ox-m-blue", "oxford", { Size: "M", Color: "Blue" }),
      variant("ox-m-white", "oxford", { Size: "M", Color: "White" }),
    ];
    products = [product("oxford")];

    const result = await run({ query: "shirt", filters: sizeM });

    expect(result.products[0].matchingVariantCount).toBe(2);
    expect(result.products[0].topVariant?.buyUrl).toBeUndefined();
    expect(result.products[0].topVariant?.cartItemId).toBeUndefined();
  });

  it("searches a wider pool and fills the limit from further down the ranking", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `p${i}`);
    products = names.map((id) => product(id));
    mockVectorSearch.mockResolvedValue(names.map((id, i) => hit(id, 1 - i / 100)));
    // Only the last three have an M.
    variants = names.map((id, i) => variant(`v-${id}`, id, { Size: i >= 9 ? "M" : "S" }));

    const result = await run({ query: "shirt", filters: sizeM, limit: 2 });

    expect(mockVectorSearch).toHaveBeenCalledWith("org-1", "shirt", 50, []);
    expect(result.products.map((p) => p.id)).toEqual(["p9", "p10"]);
  });

  it("ignores malformed option filters", async () => {
    variants = [variant("ox-s", "oxford", { Size: "S" }), variant("li-s", "linen", { Size: "S" })];

    const result = await run({
      query: "shirt",
      filters: { options: [{ name: "size" }, { name: " ", value: "M" }, "M", null] },
    });

    expect(result.products.map((p) => p.id)).toEqual(["oxford", "linen"]);
    expect(result.filtersApplied.options).toBeUndefined();
  });
});

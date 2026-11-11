/**
 * upsertProduct must not hold its transaction's connection while it calls the
 * embedding provider or takes a second pooled connection (the audit write):
 * with many upserts at once that deadlocked the DB pool on prod.
 */
const events: string[] = [];
let inTransaction = false;

const productRepo = {
  findOne: jest.fn(async () => null),
  save: jest.fn(async (p: object) => ({ ...p, id: "product-1" })),
};
const variantRepo = {
  find: jest.fn(async () => []),
  create: jest.fn((v: object) => v),
  save: jest.fn(async (v: object) => v),
  remove: jest.fn(async () => undefined),
};
const manager = {
  getRepository: (entity: { name: string }) =>
    entity.name === "ProductVariant" ? variantRepo : productRepo,
};

jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: () => productRepo,
    transaction: async (fn: (m: unknown) => Promise<unknown>) => {
      inTransaction = true;
      events.push("begin");
      try {
        return await fn(manager);
      } finally {
        events.push("commit");
        inTransaction = false;
      }
    },
  },
}));
jest.mock("@server/services/product-vector-store.service", () => ({
  productVectorStoreService: {
    embedTexts: jest.fn(async () => {
      events.push(`embed${inTransaction ? " (in tx)" : ""}`);
      return [[0.1, 0.2]];
    }),
    writeProductEmbeddings: jest.fn(async () => {
      events.push(`write embedding${inTransaction ? " (in tx)" : ""}`);
      return ["e1"];
    }),
  },
}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: {
    logProductUpsert: jest.fn(async () => {
      events.push(`audit${inTransaction ? " (in tx)" : ""}`);
    }),
  },
}));

import { productSyncService } from "@server/services/product-sync.service";

describe("ProductSyncService.upsertProduct", () => {
  it("embeds before the transaction and audits after the commit", async () => {
    const result = await productSyncService.upsertProduct(
      "org-1",
      {
        externalId: "x1",
        handle: "candle",
        title: "Aurora Soy Candle",
        variants: [{ externalId: "v1", title: "Fig", price: 29 }],
      } as never,
      "shopify",
    );

    expect(result).toEqual({ productId: "product-1", created: true, embeddingRefreshed: true });
    expect(events).toEqual(["embed", "begin", "write embedding (in tx)", "commit", "audit"]);
  });
});

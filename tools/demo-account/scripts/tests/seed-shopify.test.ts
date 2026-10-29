import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCustomers, loadOrders, loadProducts, type Flags } from "../lib/data";
import type { Customer, OrderFixture, Product } from "../lib/types";
import { seedShopify, run, type SeedOptions } from "../seed-shopify";
import { createShopify, operationName } from "../shopify/client";
import { orderCreateInput, refundInput, type OrderContext } from "../shopify/orders";
import { productSetInput } from "../shopify/products";

const NOW = new Date("2026-10-29T12:00:00Z");

const products: Product[] = [
  {
    handle: "test-candle",
    category: "candles",
    title: { en: "Test Candle", "pt-BR": "Vela" },
    description: { en: "A candle.", "pt-BR": "Uma vela." },
    details: { en: ["Soy wax"], "pt-BR": ["Cera de soja"] },
    price: { USD: 32, EUR: 29, BRL: 129 },
    compareAtPrice: { USD: 40 },
    options: [{ en: "Scent", "pt-BR": "Aroma" }],
    variants: [
      { sku: "T-CND-SAN", options: ["Sandalwood"], stock: 10 },
      { sku: "T-CND-FIG", options: ["Fig"], price: { USD: 34 }, stock: 5 },
    ],
    weightGrams: 480,
    images: ["test-candle-1.png"],
    tags: ["candle"],
    fragile: true,
  },
  {
    handle: "test-pot",
    category: "pots-and-vases",
    title: { en: "Test Pot", "pt-BR": "Vaso" },
    description: { en: "A pot.", "pt-BR": "Um vaso." },
    details: { en: [], "pt-BR": [] },
    price: { USD: 50, EUR: 45, BRL: 199 },
    options: [],
    variants: [{ sku: "T-POT", options: [], stock: 3 }],
    weightGrams: 900,
    images: ["test-pot-1.png"],
    tags: [],
    fragile: false,
  },
];

const customer: Customer = {
  key: "us-test",
  platform: "shopify",
  firstName: "Tess",
  lastName: "Ter",
  email: "tess@example.com",
  locale: "en",
  address: {
    firstName: "Tess",
    lastName: "Ter",
    address1: "1 Main St",
    city: "Austin",
    provinceCode: "TX",
    zip: "78704",
    country: "US",
  },
};

const base = {
  platforms: ["shopify"],
  purpose: "test",
  customer: { shopify: "us-test" },
  lines: [
    { sku: "T-CND-SAN", quantity: 1 },
    { sku: "T-POT", quantity: 1 },
  ],
  paymentMethod: { shopify: "card" },
  placedDaysAgo: 20,
} satisfies Partial<OrderFixture>;

const fixtures: Record<string, OrderFixture> = {
  paid: { ...base, key: "paid", financialStatus: "paid", fulfillmentStatus: "unfulfilled" },
  pending: {
    ...base,
    key: "pending",
    financialStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    lines: [{ sku: "T-CND-SAN", quantity: 1 }],
  },
  transit: {
    ...base,
    key: "transit",
    financialStatus: "paid",
    fulfillmentStatus: "in_transit",
    shippedDaysAgo: 2,
    carrier: { shopify: "USPS" },
  },
  stale: {
    ...base,
    key: "stale",
    financialStatus: "paid",
    fulfillmentStatus: "stale",
    shippedDaysAgo: 12,
    carrier: { shopify: "UPS" },
  },
  delivered: {
    ...base,
    key: "delivered",
    financialStatus: "paid",
    fulfillmentStatus: "delivered",
    shippedDaysAgo: 8,
    deliveredDaysAgo: 5,
    carrier: { shopify: "USPS" },
  },
  refunded: {
    ...base,
    key: "refunded",
    financialStatus: "refunded",
    fulfillmentStatus: "unfulfilled",
    cancelled: true,
    placedDaysAgo: 8,
    note: "Cancelled on request.",
  },
  partial: {
    ...base,
    key: "partial",
    financialStatus: "partially_refunded",
    fulfillmentStatus: "delivered",
    shippedDaysAgo: 18,
    deliveredDaysAgo: 14,
    carrier: { shopify: "USPS" },
    refundLines: [{ sku: "T-POT", quantity: 1 }],
  },
  voided: {
    ...base,
    key: "voided",
    financialStatus: "voided",
    fulfillmentStatus: "unfulfilled",
    cancelled: true,
    paymentMethod: { shopify: "manual" },
  },
};

const ctx: OrderContext = {
  products,
  customers: { "us-test": customer },
  customerIds: { "us-test": "gid://shopify/Customer/1" },
  variantIds: {
    "T-CND-SAN": "gid://shopify/ProductVariant/11",
    "T-CND-FIG": "gid://shopify/ProductVariant/12",
    "T-POT": "gid://shopify/ProductVariant/21",
  },
  now: NOW,
};

interface Call {
  op: string;
  variables: Record<string, any>;
}

/** A fake Admin GraphQL endpoint: answers by operation name and records every call. */
function fakeShopify(existingOrderTags: string[] = []) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body);
    const op = operationName(query);
    calls.push({ op, variables });
    const data: Record<string, unknown> = {
      Locations: { locations: { nodes: [{ id: "gid://shopify/Location/1", name: "Shop" }] } },
      FindProduct: { products: { nodes: [] } },
      FindCustomer: {
        customers: { nodes: [{ id: "gid://shopify/Customer/1", email: "tess@example.com" }] },
      },
      FindVariant: {
        productVariants: {
          nodes: [
            {
              id: `gid://shopify/ProductVariant/${variables.query}`,
              sku: String(variables.query).replace(/sku:"|"/g, ""),
            },
          ],
        },
      },
      ProductSet: {
        productSet: {
          product: { id: "gid://shopify/Product/1", variants: { nodes: [] } },
          userErrors: [],
        },
      },
      CustomerUpdate: {
        customerUpdate: { customer: { id: "gid://shopify/Customer/1" }, userErrors: [] },
      },
      FindOrders: {
        orders: {
          nodes: existingOrderTags
            .filter(
              (tag) => variables.query === `tag:"${tag}"` || variables.query === 'tag:"hay-demo"',
            )
            .map((tag) => ({
              id: "gid://shopify/Order/99",
              name: "#1099",
              tags: ["hay-demo", tag],
              closed: false,
              cancelledAt: null,
              displayFinancialStatus: "PAID",
              displayFulfillmentStatus: "UNFULFILLED",
              fulfillments: [],
            })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
      OrderCreate: {
        orderCreate: { order: { id: "gid://shopify/Order/1", name: "#1001" }, userErrors: [] },
      },
      FulfillmentOrders: {
        order: {
          fulfillmentOrders: {
            nodes: [{ id: "gid://shopify/FulfillmentOrder/1", status: "OPEN" }],
          },
        },
      },
      FulfillmentCreate: {
        fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/1" }, userErrors: [] },
      },
      FulfillmentEventCreate: {
        fulfillmentEventCreate: { fulfillmentEvent: { id: "e" }, userErrors: [] },
      },
      RefundDetails: {
        order: {
          lineItems: {
            nodes: [
              { id: "gid://shopify/LineItem/1", sku: "T-CND-SAN", quantity: 1 },
              { id: "gid://shopify/LineItem/2", sku: "T-POT", quantity: 1 },
            ],
          },
          transactions: [
            {
              id: "gid://shopify/OrderTransaction/1",
              kind: "SALE",
              status: "SUCCESS",
              gateway: "card",
            },
          ],
        },
      },
      RefundCreate: { refundCreate: { refund: { id: "r" }, userErrors: [] } },
      OrderCancel: {
        orderCancel: { job: { id: "j", done: false }, orderCancelUserErrors: [], userErrors: [] },
      },
      OrderClose: { orderClose: { order: { id: "x", closed: true }, userErrors: [] } },
      OrderDelete: { orderDelete: { deletedId: "x", userErrors: [] } },
      OrderState: {
        order: {
          id: "gid://shopify/Order/1",
          name: "#1001",
          tags: [],
          closed: false,
          cancelledAt: "2026-10-29T12:00:00Z",
          displayFinancialStatus: "PAID",
          displayFulfillmentStatus: "FULFILLED",
          fulfillments: [
            { displayStatus: "IN_TRANSIT", trackingInfo: [{ company: "USPS", number: "9400" }] },
          ],
        },
      },
    };
    if (!(op in data)) throw new Error(`unexpected operation ${op}`);
    return new Response(JSON.stringify({ data: data[op] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    fetchMock,
    writes: () =>
      calls
        .filter((c) => !/^(Find|Locations|FulfillmentOrders|RefundDetails|OrderState)/.test(c.op))
        .map((c) => c.op),
  };
}

const flags = (dryRun = false): Flags => ({ dryRun, only: new Set(), orderKeys: new Set() });
const ordersOnly = (keys: string[] = []): SeedOptions => ({
  only: new Set(["orders"]),
  orderKeys: new Set(keys),
  resetOrders: false,
  now: NOW,
  pollMs: 0,
});

async function seedOrders(fixture: OrderFixture, existingOrderTags: string[] = []) {
  const fake = fakeShopify(existingOrderTags);
  const shop = createShopify(flags(), "test.myshopify.com", "token", { retryDelayMs: 0 });
  const rows = await seedShopify(
    shop,
    { products, customers: [customer], orders: [fixture] },
    ordersOnly(),
  );
  return { ...fake, rows };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("productSetInput", () => {
  it("maps options, SKUs, USD prices, compareAt, weight, stock and tags", () => {
    const input = productSetInput(products[0], {
      locationId: "gid://shopify/Location/1",
      files: ["https://img/1.png"],
    });
    expect(input).toMatchObject({
      handle: "test-candle",
      title: "Test Candle",
      productType: "candles",
      status: "ACTIVE",
      productOptions: [{ name: "Scent", values: [{ name: "Sandalwood" }, { name: "Fig" }] }],
      files: [{ originalSource: "https://img/1.png", contentType: "IMAGE" }],
    });
    expect(input.tags).toEqual(
      expect.arrayContaining(["candle", "candles", "fragile", "hay-demo"]),
    );
    const variants = input.variants as any[];
    expect(variants[0]).toMatchObject({
      sku: "T-CND-SAN",
      price: "32.00",
      compareAtPrice: "40.00",
      optionValues: [{ optionName: "Scent", name: "Sandalwood" }],
      inventoryItem: { measurement: { weight: { unit: "GRAMS", value: 480 } } },
      inventoryQuantities: [
        { locationId: "gid://shopify/Location/1", name: "available", quantity: 10 },
      ],
    });
    expect(variants[1].price).toBe("34.00");
  });

  it("gives single-variant products Shopify's default option and keeps existing ids by SKU", () => {
    const input = productSetInput(products[1], {
      locationId: "L",
      existing: {
        id: "gid://shopify/Product/7",
        hasMedia: true,
        variantIds: { "T-POT": "gid://shopify/ProductVariant/70" },
      },
    });
    expect(input).toMatchObject({
      id: "gid://shopify/Product/7",
      productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    });
    expect((input.variants as any[])[0]).toMatchObject({
      id: "gid://shopify/ProductVariant/70",
      optionValues: [{ optionName: "Title", name: "Default Title" }],
    });
    expect(input).not.toHaveProperty("files");
  });
});

describe("orderCreateInput", () => {
  it("backdates, tags, adds the note and a sale transaction for paid orders", () => {
    const input = orderCreateInput({ ...fixtures.paid, note: "Leave with the doorman." }, ctx);
    expect(input).toMatchObject({
      test: true,
      currency: "USD",
      financialStatus: "PAID",
      processedAt: "2026-10-09T12:00:00.000Z",
      note: "Leave with the doorman.",
      tags: ["hay-demo", "hay-demo:paid"],
      customer: { toAssociate: { id: "gid://shopify/Customer/1" } },
      shippingAddress: { address1: "1 Main St", countryCode: "US", provinceCode: "TX" },
      // $82 > $75: free shipping
      shippingLines: [{ priceSet: { shopMoney: { amount: "0.00" } } }],
      transactions: [
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "card",
          amountSet: { shopMoney: { amount: "82.00", currencyCode: "USD" } },
        },
      ],
    });
  });

  it("creates pending and voided orders without a transaction, and charges shipping under $75", () => {
    const pending = orderCreateInput(fixtures.pending, ctx);
    expect(pending).toMatchObject({
      financialStatus: "PENDING",
      transactions: [],
      shippingLines: [{ priceSet: { shopMoney: { amount: "6.90" } } }],
    });
    expect(orderCreateInput(fixtures.voided, ctx)).toMatchObject({
      financialStatus: "VOIDED",
      transactions: [],
    });
  });

  it("creates refunded orders as paid (the refund comes after)", () => {
    expect(orderCreateInput(fixtures.refunded, ctx).financialStatus).toBe("PAID");
    expect(orderCreateInput(fixtures.partial, ctx).financialStatus).toBe("PAID");
  });
});

describe("refundInput", () => {
  const details = {
    lineItems: {
      nodes: [
        { id: "L1", sku: "T-CND-SAN", quantity: 1 },
        { id: "L2", sku: "T-POT", quantity: 1 },
      ],
    },
    transactions: [{ id: "T1", kind: "SALE", status: "SUCCESS", gateway: "card" }],
  };

  it("refunds every line and shipping for a full refund", () => {
    expect(refundInput(fixtures.refunded, "O1", details, products, NOW)).toMatchObject({
      notify: false,
      processedAt: "2026-10-26T12:00:00.000Z",
      refundLineItems: [
        { lineItemId: "L1", quantity: 1 },
        { lineItemId: "L2", quantity: 1 },
      ],
      shipping: { fullRefund: true },
      transactions: [{ parentId: "T1", amount: "82.00", kind: "REFUND", gateway: "card" }],
    });
  });

  it("refunds only refundLines for a partial refund, the day after delivery", () => {
    const input = refundInput(fixtures.partial, "O1", details, products, NOW);
    expect(input).toMatchObject({
      processedAt: "2026-10-16T12:00:00.000Z",
      refundLineItems: [{ lineItemId: "L2", quantity: 1, restockType: "NO_RESTOCK" }],
      transactions: [{ amount: "50.00" }],
    });
    expect(input).not.toHaveProperty("shipping");
  });
});

describe("order mutation sequence per state", () => {
  it.each([
    ["paid", ["OrderCreate"]],
    ["pending", ["OrderCreate"]],
    ["transit", ["OrderCreate", "FulfillmentCreate", "FulfillmentEventCreate"]],
    ["stale", ["OrderCreate", "FulfillmentCreate", "FulfillmentEventCreate"]],
    [
      "delivered",
      ["OrderCreate", "FulfillmentCreate", "FulfillmentEventCreate", "FulfillmentEventCreate"],
    ],
    ["refunded", ["OrderCreate", "RefundCreate", "OrderCancel"]],
    [
      "partial",
      [
        "OrderCreate",
        "FulfillmentCreate",
        "FulfillmentEventCreate",
        "FulfillmentEventCreate",
        "RefundCreate",
      ],
    ],
    ["voided", ["OrderCreate", "OrderCancel"]],
  ])("%s → %j", async (key, expected) => {
    const { writes } = await seedOrders(fixtures[key]);
    expect(writes()).toEqual(expected);
  });

  it("ships with tracking, sends no notification and dates the carrier events", async () => {
    const { calls } = await seedOrders(fixtures.delivered);
    const fulfillment = calls.find((c) => c.op === "FulfillmentCreate")!.variables.fulfillment;
    expect(fulfillment).toMatchObject({ notifyCustomer: false, trackingInfo: { company: "USPS" } });
    expect(fulfillment.trackingInfo.number).toMatch(/^9400\d+/);
    const events = calls
      .filter((c) => c.op === "FulfillmentEventCreate")
      .map((c) => c.variables.fulfillmentEvent);
    expect(events.map((e) => [e.status, e.happenedAt])).toEqual([
      ["IN_TRANSIT", "2026-10-21T12:00:00.000Z"],
      ["DELIVERED", "2026-10-24T12:00:00.000Z"],
    ]);
    const create = calls.find((c) => c.op === "OrderCreate")!.variables;
    expect(create.options).toEqual({
      sendReceipt: false,
      sendFulfillmentReceipt: false,
      inventoryBehaviour: "BYPASS",
    });
  });

  it("leaves a stale order with one IN_TRANSIT event at shippedDaysAgo", async () => {
    const { calls } = await seedOrders(fixtures.stale);
    const events = calls
      .filter((c) => c.op === "FulfillmentEventCreate")
      .map((c) => c.variables.fulfillmentEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: "IN_TRANSIT",
      happenedAt: "2026-10-17T12:00:00.000Z",
    });
  });

  it("cancels without refunding again, restocking or emailing", async () => {
    const { calls } = await seedOrders(fixtures.refunded);
    expect(calls.find((c) => c.op === "OrderCancel")!.variables).toMatchObject({
      reason: "CUSTOMER",
      restock: false,
      notifyCustomer: false,
      refundMethod: { originalPaymentMethodsRefund: false },
    });
    expect(calls.find((c) => c.op === "RefundCreate")!.variables.key).toBe("hay-demo-refund-1");
  });
});

describe("idempotency", () => {
  it("skips an order whose fixture tag already exists", async () => {
    const { writes, rows } = await seedOrders(fixtures.delivered, ["hay-demo:delivered"]);
    expect(writes()).toEqual([]);
    expect(rows[0]).toMatchObject({ key: "delivered", status: "existing", orderName: "#1099" });
  });

  it("does not treat another fixture's tag as a match", async () => {
    const { writes } = await seedOrders(fixtures.paid, ["hay-demo:paid-unfulfilled"]);
    expect(writes()).toEqual(["OrderCreate"]);
  });

  it("--reset-orders archives and deletes tagged orders before recreating them", async () => {
    const fake = fakeShopify(["hay-demo:paid"]);
    const shop = createShopify(flags(), "test.myshopify.com", "token");
    await seedShopify(
      shop,
      { products, customers: [customer], orders: [fixtures.paid] },
      { ...ordersOnly(), resetOrders: true },
    );
    // The fake still reports the tag afterwards, so the order step sees it and skips.
    expect(fake.writes()).toEqual(["OrderClose", "OrderDelete"]);
  });

  it("updates products found by handle instead of creating them", async () => {
    const fake = fakeShopify();
    fake.fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({ data: { locations: { nodes: [{ id: "L", name: "Shop" }] } } }),
        ),
    );
    fake.fetchMock.mockImplementationOnce(async (_u: string, init: { body: string }) => {
      fake.calls.push({ op: "FindProduct", variables: JSON.parse(init.body).variables });
      return new Response(
        JSON.stringify({
          data: {
            products: {
              nodes: [
                {
                  id: "gid://shopify/Product/5",
                  media: { nodes: [{ id: "m" }] },
                  variants: { nodes: [] },
                },
              ],
            },
          },
        }),
      );
    });
    const shop = createShopify(flags(), "test.myshopify.com", "token");
    await seedShopify(
      shop,
      { products: [products[1]], customers: [], orders: [] },
      { only: new Set(["products"]), orderKeys: new Set(), resetOrders: false },
    );
    const set = fake.calls.find((c) => c.op === "ProductSet")!.variables.input;
    expect(set.id).toBe("gid://shopify/Product/5");
    expect(set).not.toHaveProperty("files");
    expect(fake.writes()).toEqual(["ProductSet"]);
  });
});

describe("dry-run", () => {
  it("sends nothing at all for the real fixtures, without credentials", async () => {
    const fake = fakeShopify();
    const shop = createShopify(flags(true), "dry-run.myshopify.com", "");
    const rows = await seedShopify(
      shop,
      {
        products: loadProducts(),
        customers: loadCustomers("shopify"),
        orders: loadOrders("shopify"),
      },
      {
        only: new Set(),
        orderKeys: new Set(),
        resetOrders: true,
        imageBaseUrl: "https://img.example",
      },
    );
    expect(fake.fetchMock).not.toHaveBeenCalled();
    expect(rows.length).toBe(loadOrders("shopify").length);
    expect(rows.every((r) => r.status === "planned")).toBe(true);
  });

  it("run() exits 0 with --dry-run and no env, and 1 without credentials for a real run", async () => {
    const fake = fakeShopify();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = { d: process.env.SHOPIFY_STORE_DOMAIN, t: process.env.SHOPIFY_ADMIN_TOKEN };
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    try {
      expect(await run(["--dry-run", "--only", "orders", "--orders", "delivered,refunded"])).toBe(
        0,
      );
      expect(fake.fetchMock).not.toHaveBeenCalled();
      // Only meaningful when tools/demo-account/.env doesn't set the credentials.
      if (!process.env.SHOPIFY_ADMIN_TOKEN) expect(await run(["--only", "orders"])).toBe(1);
    } finally {
      if (saved.d !== undefined) process.env.SHOPIFY_STORE_DOMAIN = saved.d;
      if (saved.t !== undefined) process.env.SHOPIFY_ADMIN_TOKEN = saved.t;
    }
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockShopify } = require("./harness");
const { registerExchangeTools } = require("../tools/exchanges");
const { resetScopeCache } = require("../lib/scopes");

const ORDER = "gid://shopify/Order/1";
const LINE = "gid://shopify/LineItem/11";
const OLD_VARIANT = "gid://shopify/ProductVariant/100";
const NEW_VARIANT = "gid://shopify/ProductVariant/200";
const PRODUCT = "gid://shopify/Product/9";

function order(overrides = {}) {
  return {
    id: ORDER,
    name: "#1001",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    fulfillments: [],
    lineItems: {
      nodes: [
        {
          id: LINE,
          title: "Tee",
          currentQuantity: 1,
          unfulfilledQuantity: 1,
          variant: { id: OLD_VARIANT, title: "M", product: { id: PRODUCT } },
          originalUnitPriceSet: { shopMoney: { amount: "50.00", currencyCode: "BRL" } },
        },
      ],
    },
    ...overrides,
  };
}

function variant(overrides = {}) {
  return {
    id: NEW_VARIANT,
    title: "L",
    price: "50.00",
    availableForSale: true,
    inventoryQuantity: 3,
    inventoryPolicy: "DENY",
    inventoryItem: { tracked: true },
    product: { id: PRODUCT, title: "Tee" },
    ...overrides,
  };
}

function editHandlers({
  ctx = {},
  outstanding = "0.00",
  scopes = ["write_orders", "write_order_edits"],
} = {}) {
  return {
    SwapContext: () => ({ order: order(ctx.order), productVariant: variant(ctx.variant) }),
    AppScopes: () => ({
      currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) },
    }),
    OrderEditBegin: () => ({
      orderEditBegin: {
        calculatedOrder: {
          id: "gid://shopify/CalculatedOrder/5",
          lineItems: {
            nodes: [
              {
                id: "gid://shopify/CalculatedLineItem/11",
                quantity: 1,
                variant: { id: OLD_VARIANT },
              },
            ],
          },
        },
        userErrors: [],
      },
    }),
    OrderEditSetQuantity: () => ({
      orderEditSetQuantity: { calculatedLineItem: { id: "x", quantity: 0 }, userErrors: [] },
    }),
    OrderEditAddVariant: () => ({
      orderEditAddVariant: {
        calculatedLineItem: { id: "y", quantity: 1 },
        calculatedOrder: {
          id: "gid://shopify/CalculatedOrder/5",
          totalOutstandingSet: { shopMoney: { amount: outstanding, currencyCode: "BRL" } },
        },
        userErrors: [],
      },
    }),
    OrderEditCommit: () => ({
      orderEditCommit: { order: { id: ORDER, name: "#1001" }, userErrors: [] },
    }),
  };
}

const ARGS = { order_id: "1", line_item_id: LINE, new_variant_id: "200" };

describe("shopify_swap_order_item", () => {
  let server;
  beforeEach(() => {
    resetScopeCache();
    server = createFakeServer();
    registerExchangeTools(server);
  });

  it("swaps the variant through a committed order edit", async () => {
    const { calls } = mockShopify(editHandlers());
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.isError).toBe(false);
    expect(res.data.swapped).toBe(true);
    expect(res.data.owedToShopper).toBeNull();
    const setQty = calls.find((c) => c.op === "OrderEditSetQuantity");
    expect(setQty.variables).toMatchObject({
      lineItemId: "gid://shopify/CalculatedLineItem/11",
      quantity: 0,
    });
    expect(setQty.query).toMatch(/restock: true/);
    expect(calls.find((c) => c.op === "OrderEditAddVariant").variables).toMatchObject({
      variantId: NEW_VARIANT,
      quantity: 1,
    });
    expect(calls.map((c) => c.op)).toContain("OrderEditCommit");
  });

  it("reports (but does not refund) the difference when the new variant is cheaper", async () => {
    mockShopify(editHandlers({ ctx: { variant: { price: "40.00" } }, outstanding: "-10.00" }));
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.data.owedToShopper).toEqual({ amount: "10.00", currencyCode: "BRL" });
    expect(res.data.note).toMatch(/No refund was made/);
  });

  it("refuses after dispatch without opening an edit", async () => {
    const { calls } = mockShopify(
      editHandlers({
        ctx: {
          order: {
            displayFulfillmentStatus: "FULFILLED",
            fulfillments: [{ status: "SUCCESS", displayStatus: "FULFILLED" }],
          },
        },
      }),
    );
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("PRECONDITION");
    expect(calls.map((c) => c.op)).not.toContain("OrderEditBegin");
  });

  it("refuses a pricier variant", async () => {
    mockShopify(editHandlers({ ctx: { variant: { price: "60.00" } } }));
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.data.code).toBe("PRECONDITION");
    expect(res.data.details.reason).toBe("PRICE_HIGHER");
  });

  it("refuses an out-of-stock variant", async () => {
    mockShopify(editHandlers({ ctx: { variant: { inventoryQuantity: 0 } } }));
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.data.details.reason).toBe("OUT_OF_STOCK");
  });

  it("refuses a different product", async () => {
    mockShopify(
      editHandlers({
        ctx: { variant: { product: { id: "gid://shopify/Product/77", title: "Cap" } } },
      }),
    );
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.data.details.reason).toBe("DIFFERENT_PRODUCT");
  });

  it("never commits when the shopper would owe money", async () => {
    const { calls } = mockShopify(editHandlers({ outstanding: "5.00" }));
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.data.details.reason).toBe("BALANCE_DUE");
    expect(calls.map((c) => c.op)).not.toContain("OrderEditCommit");
  });

  it("asks the store to re-approve Hay.chat when write_order_edits is missing", async () => {
    const { calls } = mockShopify(editHandlers({ scopes: ["write_orders"] }));
    const res = await server.call("shopify_swap_order_item", ARGS);
    expect(res.data.code).toBe("SCOPE_MISSING");
    expect(res.data.details.missingScopes).toEqual(["write_order_edits"]);
    expect(calls.map((c) => c.op)).not.toContain("OrderEditBegin");
  });
});

const FLI = "gid://shopify/FulfillmentLineItem/31";

function exchangeHandlers({ newPrice = "50.00", stock = 3, processErrors = [] } = {}) {
  return {
    ExchangeContext: () => ({
      order: { id: ORDER, name: "#1001", cancelledAt: null },
      returnableFulfillments: {
        nodes: [
          {
            returnableFulfillmentLineItems: {
              nodes: [
                {
                  quantity: 1,
                  fulfillmentLineItem: {
                    id: FLI,
                    lineItem: {
                      id: LINE,
                      title: "Tee",
                      discountedUnitPriceAfterAllDiscountsSet: {
                        shopMoney: { amount: "50.00", currencyCode: "BRL" },
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
      nodes: [variant({ price: newPrice, inventoryQuantity: stock })],
    }),
    AppScopes: () => ({
      currentAppInstallation: { accessScopes: [{ handle: "write_returns" }] },
    }),
    CreateExchange: () => ({
      returnCreate: {
        return: {
          id: "gid://shopify/Return/7",
          status: "OPEN",
          name: "#1001-R1",
          returnLineItems: { nodes: [{ id: "gid://shopify/ReturnLineItem/1", quantity: 1 }] },
          exchangeLineItems: {
            nodes: [
              {
                id: "gid://shopify/ExchangeLineItem/2",
                quantity: 1,
                lineItems: [
                  { id: "gid://shopify/LineItem/99", title: "Tee", variant: { id: NEW_VARIANT } },
                ],
              },
            ],
          },
        },
        userErrors: [],
      },
    }),
    ProcessExchange: () => ({
      returnProcess: {
        return: { id: "gid://shopify/Return/7", status: "CLOSED" },
        userErrors: processErrors,
      },
    }),
  };
}

const EX_ARGS = {
  order_id: "1",
  return_line_items: [{ fulfillmentLineItemId: FLI, quantity: 1, returnReasonNote: "too small" }],
  exchange_items: [{ variantId: "200", quantity: 1 }],
};

describe("shopify_create_exchange", () => {
  let server;
  beforeEach(() => {
    resetScopeCache();
    server = createFakeServer();
    registerExchangeTools(server);
  });

  it("creates the return with exchange items and processes it", async () => {
    const { calls } = mockShopify(exchangeHandlers());
    const res = await server.call("shopify_create_exchange", EX_ARGS);
    expect(res.isError).toBe(false);
    expect(res.data.exchanged).toBe(true);
    const create = calls.find((c) => c.op === "CreateExchange");
    expect(create.variables.returnInput.exchangeLineItems).toEqual([
      { variantId: NEW_VARIANT, quantity: 1 },
    ]);
    const proc = calls.find((c) => c.op === "ProcessExchange");
    expect(proc.variables.input).toMatchObject({
      returnId: "gid://shopify/Return/7",
      returnLineItems: [{ id: "gid://shopify/ReturnLineItem/1", quantity: 1 }],
      exchangeLineItems: [{ id: "gid://shopify/ExchangeLineItem/2", quantity: 1 }],
      notifyCustomer: true,
    });
  });

  it("hands off when the shopper would owe money", async () => {
    const { calls } = mockShopify(exchangeHandlers({ newPrice: "70.00" }));
    const res = await server.call("shopify_create_exchange", EX_ARGS);
    expect(res.data.code).toBe("PRECONDITION");
    expect(res.data.details.reason).toBe("BALANCE_DUE");
    expect(calls.map((c) => c.op)).not.toContain("CreateExchange");
  });

  it("refuses an out-of-stock replacement", async () => {
    mockShopify(exchangeHandlers({ stock: 0 }));
    const res = await server.call("shopify_create_exchange", EX_ARGS);
    expect(res.data.details.reason).toBe("OUT_OF_STOCK");
  });

  it("refuses an item that is not returnable", async () => {
    mockShopify(exchangeHandlers());
    const res = await server.call("shopify_create_exchange", {
      ...EX_ARGS,
      return_line_items: [
        { fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/404", quantity: 1 },
      ],
    });
    expect(res.data.details.reason).toBe("NOT_RETURNABLE");
  });

  it("does not claim success when Shopify refuses to process", async () => {
    mockShopify(exchangeHandlers({ processErrors: [{ field: ["x"], message: "nope" }] }));
    const res = await server.call("shopify_create_exchange", EX_ARGS);
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe("PROVIDER_REFUSED");
    expect(res.data.message).toMatch(/created but not processed/);
    expect(res.data.details.returnId).toBe("gid://shopify/Return/7");
  });
});

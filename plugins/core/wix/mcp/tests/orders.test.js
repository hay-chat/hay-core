import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerOrderTools } = require("../tools/orders");
const { registerCustomerTools } = require("../tools/customers");
const { enrichOrder, paymentBalances } = require("../lib/orders");

process.env.WIX_API_KEY = "test-key";
process.env.WIX_SITE_ID = "site-1";

const ORDER = {
  id: "ord-1",
  number: "10042",
  status: "APPROVED",
  paymentStatus: "PAID",
  fulfillmentStatus: "NOT_FULFILLED",
  currency: "EUR",
  createdDate: "2026-10-01T10:00:00Z",
  priceSummary: { total: { amount: "50.00" } },
  balanceSummary: { paid: { amount: "50.00" }, refunded: { amount: "0.00" } },
  buyerInfo: { contactId: "c-1", email: "ana@example.com" },
  billingInfo: { contactDetails: { firstName: "Ana", lastName: "Silva", phone: "+351" } },
  shippingInfo: {
    logistics: {
      shippingDestination: {
        address: { addressLine: "Rua A 1", city: "Lisboa", postalCode: "1000", country: "PT" },
        contactDetails: { firstName: "Ana", lastName: "Silva" },
      },
    },
  },
  lineItems: [
    {
      id: "li-1",
      productName: { original: "Hat" },
      quantity: 2,
      physicalProperties: { sku: "HAT-1" },
      price: { amount: "25.00" },
    },
  ],
};

const TRANSACTIONS = {
  payments: [
    {
      id: "pay-1",
      amount: { amount: "50.00" },
      regularPaymentDetails: { status: "APPROVED", paymentMethod: "CreditCard" },
    },
  ],
  refunds: [],
};

const FULFILLMENTS = [
  {
    id: "ful-1",
    createdDate: "2026-10-02T10:00:00Z",
    lineItems: [{ id: "li-1", quantity: 2 }],
    trackingInfo: { trackingNumber: "TRK1", shippingProvider: "dhl", trackingLink: "https://t/1" },
  },
];

function orderRoutes(order, { transactions = TRANSACTIONS, fulfillments = [] } = {}) {
  return [
    {
      method: "POST",
      path: "/ecom/v1/orders/search",
      reply: ({ body }) => {
        // Wix wraps the CursorSearch under `search`; a bare top-level filter
        // would be ignored and return the newest orders of the whole store.
        expect(body.filter).toBeUndefined();
        const number = body.search?.filter?.number;
        const email = body.search?.filter?.["buyerInfo.email"];
        if (number && number !== order.number) return { orders: [] };
        if (email && email !== order.buyerInfo.email) return { orders: [] };
        return { orders: [order], pagingMetadata: { hasNext: false } };
      },
    },
    { method: "GET", path: `/ecom/v1/orders/${order.id}`, reply: () => ({ order }) },
    {
      method: "GET",
      path: `/ecom/v1/orders/${order.id}/transactions`,
      reply: () => ({ orderTransactions: transactions }),
    },
    {
      method: "GET",
      path: `/ecom/v1/orders/${order.id}/fulfillments`,
      reply: () => ({ orderWithFulfillments: { fulfillments } }),
    },
  ];
}

describe("enrichOrder", () => {
  it("computes the support summary from order + transactions + fulfilments", () => {
    const enriched = enrichOrder(ORDER, TRANSACTIONS, FULFILLMENTS);
    expect(enriched.supportSummary).toMatchObject({
      isCancellable: true,
      isRefundable: true,
      remainingRefundable: { amount: "50.00", currency: "EUR" },
      addressChangeable: true,
      shippedAt: "2026-10-02T10:00:00Z",
    });
    expect(enriched.lineItems[0]).toMatchObject({ name: "Hat", sku: "HAT-1", quantity: 2 });
    expect(enriched.tracking[0]).toMatchObject({ trackingNumber: "TRK1", carrier: "dhl" });
  });

  it("is not cancellable or address-changeable once fulfilled, and remaining shrinks after refunds", () => {
    const fulfilled = {
      ...ORDER,
      fulfillmentStatus: "FULFILLED",
      balanceSummary: { paid: { amount: "50.00" }, refunded: { amount: "20.00" } },
    };
    const enriched = enrichOrder(fulfilled, TRANSACTIONS, FULFILLMENTS);
    expect(enriched.supportSummary.isCancellable).toBe(false);
    expect(enriched.supportSummary.addressChangeable).toBe(false);
    expect(enriched.supportSummary.remainingRefundable.amount).toBe("30.00");
  });

  it("falls back to transactions when balanceSummary is missing and degrades without reads", () => {
    const { balanceSummary: _b, ...noBalance } = ORDER;
    const tx = {
      payments: TRANSACTIONS.payments,
      refunds: [
        {
          transactions: [
            { paymentId: "pay-1", amount: { amount: "10.00" }, refundStatus: "SUCCEEDED" },
          ],
        },
      ],
    };
    expect(enrichOrder(noBalance, tx, null).supportSummary.remainingRefundable.amount).toBe(
      "40.00",
    );
    expect(enrichOrder(noBalance, null, null).supportSummary.remainingRefundable.amount).toBe(
      "0.00",
    );
  });
});

describe("paymentBalances", () => {
  it("subtracts non-failed refunds per payment", () => {
    const tx = {
      payments: [
        { id: "p1", amount: { amount: "30" }, regularPaymentDetails: { status: "APPROVED" } },
        { id: "p2", amount: { amount: "20" }, refundDisabled: true, giftcardPaymentDetails: {} },
      ],
      refunds: [
        {
          transactions: [
            { paymentId: "p1", amount: { amount: "5" }, refundStatus: "SUCCEEDED" },
            { paymentId: "p1", amount: { amount: "7" }, refundStatus: "FAILED" },
          ],
        },
      ],
    };
    const balances = paymentBalances(tx);
    expect(balances).toEqual([
      expect.objectContaining({ paymentId: "p1", paid: 30, refunded: 5, remaining: 25 }),
      expect.objectContaining({
        paymentId: "p2",
        refundDisabled: true,
        paymentMethod: "GIFT_CARD",
        remaining: 20,
      }),
    ]);
  });
});

describe("order tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerOrderTools(server);
    registerCustomerTools(server);
  });

  it("registers exactly the semantic order + customer tools", () => {
    expect([...server.tools.keys()].sort()).toEqual([
      "wix_cancel_order",
      "wix_find_customer",
      "wix_get_order",
      "wix_get_order_tracking",
      "wix_list_customer_orders",
      "wix_update_order_shipping_address",
    ]);
  });

  it("wix_get_order by number merges the three reads", async () => {
    const { calls } = mockFetch(orderRoutes(ORDER, { fulfillments: FULFILLMENTS }));
    const res = await server.call("wix_get_order", { order_number: "#10042" });
    expect(res.isError).toBe(false);
    expect(res.data.id).toBe("ord-1");
    expect(res.data.supportSummary.isRefundable).toBe(true);
    expect(res.data.tracking).toHaveLength(1);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /ecom/v1/orders/search",
      "GET /ecom/v1/orders/ord-1/transactions",
      "GET /ecom/v1/orders/ord-1/fulfillments",
    ]);
    expect(calls[0].body.search.filter.number).toBe("10042");
    expect(calls[0].body.search.cursorPaging.limit).toBe(1);
    // Projected, not the raw Wix order.
    expect(res.data.buyer).toMatchObject({ email: "ana@example.com", firstName: "Ana" });
    expect(res.data.shippingAddress.address.city).toBe("Lisboa");
    expect(res.data.billingInfo).toBeUndefined();
    expect(res.data.buyerInfo).toBeUndefined();
  });

  it("wix_get_order rejects a search hit whose number does not match (Wix ignores bad filters)", async () => {
    const { calls } = mockFetch([
      {
        method: "POST",
        path: "/ecom/v1/orders/search",
        reply: () => ({ orders: [ORDER], pagingMetadata: { hasNext: false } }),
      },
      ...orderRoutes(ORDER).slice(1),
    ]);
    const res = await server.call("wix_get_order", { order_number: "99" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No order with number 99/);
    expect(calls).toHaveLength(1);
  });

  it("wix_get_order rejects both or neither reference, and reports unknown numbers", async () => {
    mockFetch(orderRoutes(ORDER));
    expect((await server.call("wix_get_order", {})).text).toMatch(/order_id or order_number/);
    expect(
      (await server.call("wix_get_order", { order_id: "ord-1", order_number: "10042" })).text,
    ).toMatch(/not both/);
    expect((await server.call("wix_get_order", { order_number: "99" })).text).toMatch(
      /No order with number 99/,
    );
  });

  it("wix_get_order_tracking flattens fulfilments", async () => {
    mockFetch(orderRoutes(ORDER, { fulfillments: FULFILLMENTS }));
    const res = await server.call("wix_get_order_tracking", { order_id: "ord-1" });
    expect(res.data).toEqual({
      id: "ord-1",
      number: "10042",
      fulfillmentStatus: "NOT_FULFILLED",
      tracking: [
        expect.objectContaining({
          fulfillmentId: "ful-1",
          trackingNumber: "TRK1",
          trackingUrl: "https://t/1",
        }),
      ],
    });
  });

  it("wix_cancel_order cancels an unfulfilled order and points at the refund", async () => {
    const { calls } = mockFetch([
      ...orderRoutes(ORDER),
      {
        method: "POST",
        path: "/ecom/v1/orders/ord-1/cancel",
        reply: () => ({ order: { status: "CANCELED" } }),
      },
    ]);
    const res = await server.call("wix_cancel_order", { order_id: "ord-1", notify_customer: true });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("CANCELLED");
    const cancel = calls.find((c) => c.path.endsWith("/cancel"));
    expect(cancel.body).toEqual({ restockAllItems: true, sendOrderCanceledEmail: true });
    expect(res.data.detail).toMatch(/wix_create_refund/);
    expect(res.data.remainingRefundable).toEqual({ amount: "50.00", currency: "EUR" });
  });

  it("wix_cancel_order refuses fulfilled and already-cancelled orders without calling Wix", async () => {
    const { calls } = mockFetch(orderRoutes({ ...ORDER, fulfillmentStatus: "FULFILLED" }));
    const res = await server.call("wix_cancel_order", { order_id: "ord-1" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/fulfilment status FULFILLED/);
    expect(calls.some((c) => c.path.endsWith("/cancel"))).toBe(false);

    mockFetch(orderRoutes({ ...ORDER, status: "CANCELED" }));
    expect((await server.call("wix_cancel_order", { order_id: "ord-1" })).text).toMatch(
      /already cancelled/,
    );
  });

  it("wix_update_order_shipping_address merges fields and keeps the address line key", async () => {
    const { calls } = mockFetch([
      ...orderRoutes(ORDER),
      {
        method: "PATCH",
        path: "/ecom/v1/orders/ord-1",
        reply: ({ body }) => ({ order: body.order }),
      },
    ]);
    const res = await server.call("wix_update_order_shipping_address", {
      order_number: "10042",
      address: { addressLine1: "Rua B 2", postalCode: "2000", phone: "+351999" },
    });
    expect(res.isError).toBe(false);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.order.shippingInfo.logistics.shippingDestination).toEqual({
      address: { addressLine: "Rua B 2", city: "Lisboa", postalCode: "2000", country: "PT" },
      contactDetails: { firstName: "Ana", lastName: "Silva", phone: "+351999" },
    });
    expect(patch.body.fieldMask).toEqual(["shippingInfo.logistics.shippingDestination"]);
  });

  it("wix_update_order_shipping_address refuses once dispatched", async () => {
    const { calls } = mockFetch(
      orderRoutes({ ...ORDER, fulfillmentStatus: "PARTIALLY_FULFILLED" }),
    );
    const res = await server.call("wix_update_order_shipping_address", {
      order_id: "ord-1",
      address: { city: "Porto" },
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/before dispatch/);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("customer tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerCustomerTools(server);
  });

  it("wix_find_customer derives the customer from their orders", async () => {
    const { calls } = mockFetch(orderRoutes(ORDER));
    const res = await server.call("wix_find_customer", { email: "ana@example.com" });
    expect(res.data).toMatchObject({
      found: true,
      customer: { email: "ana@example.com", contactId: "c-1", firstName: "Ana", lastName: "Silva" },
      recentOrders: [{ id: "ord-1", number: "10042", paymentStatus: "PAID" }],
    });
    expect(calls[0].body.search.filter).toEqual({ "buyerInfo.email": "ana@example.com" });
    expect(calls[0].body.search.cursorPaging.limit).toBe(5);
  });

  it("wix_find_customer only returns orders whose buyer email really matches", async () => {
    const stranger = { ...ORDER, id: "ord-9", number: "9", buyerInfo: { email: "x@example.com" } };
    mockFetch([
      {
        method: "POST",
        path: "/ecom/v1/orders/search",
        reply: () => ({ orders: [stranger, ORDER], pagingMetadata: { hasNext: false } }),
      },
    ]);
    const res = await server.call("wix_find_customer", { email: "ANA@example.com " });
    expect(res.data.recentOrders.map((o) => o.id)).toEqual(["ord-1"]);

    mockFetch([
      {
        method: "POST",
        path: "/ecom/v1/orders/search",
        reply: () => ({ orders: [stranger], pagingMetadata: { hasNext: false } }),
      },
    ]);
    expect((await server.call("wix_find_customer", { email: "ana@example.com" })).data.found).toBe(
      false,
    );
  });

  it("wix_find_customer reports found=false for an unknown email", async () => {
    mockFetch(orderRoutes(ORDER));
    const res = await server.call("wix_find_customer", { email: "nobody@example.com" });
    expect(res.isError).toBe(false);
    expect(res.data.found).toBe(false);
  });

  it("wix_list_customer_orders pages and caps the limit", async () => {
    const { calls } = mockFetch([
      {
        method: "POST",
        path: "/ecom/v1/orders/search",
        reply: () => ({
          orders: [ORDER],
          pagingMetadata: { hasNext: true, cursors: { next: "c2" } },
        }),
      },
    ]);
    const res = await server.call("wix_list_customer_orders", {
      email: "ana@example.com",
      limit: 500,
    });
    expect(res.data).toEqual({
      items: [expect.objectContaining({ id: "ord-1" })],
      hasNext: true,
      nextCursor: "c2",
    });
    expect(calls[0].body.search.cursorPaging.limit).toBe(100);
  });
});

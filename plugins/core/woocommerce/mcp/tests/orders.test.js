import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerOrderTools } = require("../tools/orders");
const { registerCustomerTools } = require("../tools/customers");
const { enrichOrder, trackingFromGenericMeta, normalizeTrackingItem } = require("../lib/orders");

process.env.WORDPRESS_SITE_URL = "https://store.test/";
process.env.WOOCOMMERCE_CONSUMER_KEY = "ck";
process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs";

const ORDER = {
  id: 12,
  number: "12",
  status: "processing",
  currency: "EUR",
  date_created: "2026-10-01T10:00:00",
  date_paid: "2026-10-01T10:01:00",
  date_completed: null,
  total: "60.00",
  total_tax: "10.00",
  shipping_total: "5.00",
  discount_total: "0.00",
  customer_id: 7,
  payment_method: "stripe",
  payment_method_title: "Card (Stripe)",
  billing: {
    first_name: "Ana",
    last_name: "Silva",
    email: "ana@example.com",
    phone: "+351 912 345 678",
  },
  shipping: {
    first_name: "Ana",
    last_name: "Silva",
    address_1: "Rua A 1",
    city: "Lisboa",
    postcode: "1000",
    country: "PT",
  },
  line_items: [
    {
      id: 101,
      name: "Hat",
      product_id: 5,
      variation_id: 0,
      quantity: 2,
      sku: "HAT-1",
      total: "45.00",
      total_tax: "10.00",
      taxes: [{ id: 1, total: "10.00" }],
    },
  ],
  shipping_lines: [{ id: 201, method_title: "Flat rate", total: "5.00" }],
  refunds: [],
  meta_data: [],
};

const WC = "/wp-json/wc/v3";

function orderRoutes(order, extra = []) {
  return [
    { method: "GET", path: `${WC}/orders/${order.id}`, reply: () => order },
    {
      method: "GET",
      path: `${WC}/orders`,
      reply: ({ query }) => {
        const search = query.get("search");
        const customer = query.get("customer");
        if (customer) return String(order.customer_id) === customer ? [order] : [];
        if (
          search &&
          (search === String(order.number) || search.toLowerCase() === order.billing.email)
        )
          return [order];
        return [];
      },
    },
    ...extra,
  ];
}

describe("enrichOrder", () => {
  it("derives the support summary for a paid, unshipped order", () => {
    const e = enrichOrder(ORDER, []);
    expect(e.supportSummary).toEqual({
      isCancellable: true,
      isRefundable: true,
      remainingRefundable: { amount: "60.00", currency: "EUR" },
      addressChangeable: true,
      shippedAt: null,
      deliveredAt: null,
      tracking: expect.objectContaining({ isStale: false, shippedAt: null }),
    });
    expect(e.lineItems[0]).toMatchObject({ id: 101, sku: "HAT-1", quantity: 2 });
    expect(e.shippingMethod).toBe("Flat rate");
  });

  it("subtracts refunds, blocks cancel/address after completion, and refuses refunds on unpaid orders", () => {
    const completed = {
      ...ORDER,
      status: "completed",
      date_completed: "2026-10-03T00:00:00",
      refunds: [{ id: 9, reason: "x", total: "-20.00" }],
    };
    const e = enrichOrder(completed, [{ trackingNumber: "T", shippedAt: "2026-10-02T00:00:00Z" }]);
    expect(e.supportSummary).toMatchObject({
      isCancellable: false,
      addressChangeable: false,
      isRefundable: true,
      remainingRefundable: { amount: "40.00" },
      shippedAt: "2026-10-02T00:00:00Z",
    });
    expect(e.totals.refunded).toBe("20.00");

    const unpaid = { ...ORDER, status: "pending", date_paid: null };
    expect(enrichOrder(unpaid, []).supportSummary.isRefundable).toBe(false);

    // A paid order that was cancelled still owes the customer money.
    const cancelledPaid = { ...ORDER, status: "cancelled" };
    expect(enrichOrder(cancelledPaid, []).supportSummary).toMatchObject({
      isRefundable: true,
      isCancellable: false,
    });

    // Processing but tracking already recorded: it has left the warehouse.
    const processingShipped = enrichOrder(ORDER, [{ trackingNumber: "T" }]);
    expect(processingShipped.supportSummary).toMatchObject({
      isCancellable: false,
      addressChangeable: false,
    });
  });
});

describe("tracking normalisation", () => {
  it("reads official plugin records including epoch date_shipped", () => {
    expect(
      normalizeTrackingItem({
        tracking_provider: "DHL",
        tracking_number: "JD1",
        tracking_link: "https://dhl/JD1",
        date_shipped: "1760000000",
      }),
    ).toEqual({
      trackingNumber: "JD1",
      carrier: "DHL",
      trackingUrl: "https://dhl/JD1",
      shippedAt: "2025-10-09T08:53:20.000Z",
      source: "plugin",
    });
    expect(normalizeTrackingItem({ tracking_provider: "x" })).toBeNull();
  });

  it("falls back to any *tracking* meta key", () => {
    expect(
      trackingFromGenericMeta([
        { key: "_ywot_tracking_code", value: "YT123" },
        { key: "_ywot_carrier_name", value: "CTT" },
        { key: "_ywot_tracking_url", value: "https://ctt/YT123" },
        { key: "_other", value: "ignored" },
      ]),
    ).toEqual([
      {
        trackingNumber: "YT123",
        carrier: null,
        trackingUrl: "https://ctt/YT123",
        shippedAt: null,
        source: "meta",
      },
    ]);
    expect(trackingFromGenericMeta([{ key: "_wc_shipment_tracking_items", value: [] }])).toEqual(
      [],
    );
  });
});

describe("order tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerOrderTools(server);
  });

  it("woocommerce_get_order by number verifies the direct hit and uses the tracking endpoint", async () => {
    const { calls } = mockFetch(
      orderRoutes(ORDER, [
        {
          method: "GET",
          path: `${WC}/orders/12/shipment-trackings`,
          reply: () => [{ tracking_provider: "DHL", tracking_number: "JD1" }],
        },
      ]),
    );
    const res = await server.call("woocommerce_get_order", { order_number: "#12" });
    expect(res.isError).toBe(false);
    expect(res.data.tracking).toEqual([
      expect.objectContaining({ trackingNumber: "JD1", carrier: "DHL", source: "wc/v3" }),
    ]);
    // The store-country lookup (stale-tracking threshold) is a cached side read.
    expect(calls.map((c) => c.path).filter((p) => !p.includes("/settings/"))).toEqual([
      `${WC}/orders/12`,
      `${WC}/orders/12/shipment-trackings`,
    ]);
    expect(calls[0].query.get("consumer_key")).toBe("ck");
  });

  it("woocommerce_get_order falls back to search when the number is not the id, then to AST, then to meta", async () => {
    const sequential = {
      ...ORDER,
      id: 5000,
      number: "12",
      meta_data: [
        {
          key: "_wc_shipment_tracking_items",
          value: [{ tracking_provider: "ups", tracking_number: "1Z" }],
        },
      ],
    };
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${WC}/orders/12`,
        reply: () => ({
          status: 404,
          body: { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID." },
        }),
      },
      { method: "GET", path: `${WC}/orders`, reply: () => [sequential] },
      {
        method: "GET",
        path: `${WC}/orders/5000/shipment-trackings`,
        reply: () => ({ status: 404, body: { code: "rest_no_route", message: "No route" } }),
      },
      { method: "GET", path: `/wp-json/wc-ast/v3/orders/5000/shipment-trackings`, reply: () => [] },
    ]);
    const res = await server.call("woocommerce_get_order", { order_number: "12" });
    expect(res.data.id).toBe(5000);
    expect(res.data.tracking).toEqual([
      expect.objectContaining({ trackingNumber: "1Z", carrier: "ups", source: "meta" }),
    ]);
    expect(calls.map((c) => c.path).filter((p) => !p.includes("/settings/"))).toEqual([
      `${WC}/orders/12`,
      `${WC}/orders`,
      `${WC}/orders/5000/shipment-trackings`,
      `/wp-json/wc-ast/v3/orders/5000/shipment-trackings`,
    ]);
  });

  it("woocommerce_get_order reports unknown ids and numbers with a recovery hint", async () => {
    mockFetch([
      {
        method: "GET",
        path: /orders\/\d+$/,
        reply: () => ({
          status: 404,
          body: { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID." },
        }),
      },
      { method: "GET", path: `${WC}/orders`, reply: () => [] },
    ]);
    expect((await server.call("woocommerce_get_order", { order_id: "77" })).text).toMatch(
      /Order 77 not found.*woocommerce_find_customer/,
    );
    expect((await server.call("woocommerce_get_order", { order_number: "77" })).text).toMatch(
      /No order with number 77/,
    );
    expect((await server.call("woocommerce_get_order", {})).text).toMatch(
      /order_id or order_number/,
    );
  });

  it("woocommerce_cancel_order cancels a processing order, adds the note, and points at the refund", async () => {
    const { calls } = mockFetch(
      orderRoutes(ORDER, [
        { method: "PUT", path: `${WC}/orders/12`, reply: ({ body }) => ({ ...ORDER, ...body }) },
        {
          method: "POST",
          path: `${WC}/orders/12/notes`,
          reply: ({ body }) => ({ id: 1, ...body }),
        },
      ]),
    );
    const res = await server.call("woocommerce_cancel_order", {
      order_id: "12",
      note: "customer asked",
    });
    expect(res.data).toMatchObject({ status: "CANCELLED", orderStatus: "cancelled" });
    expect(res.data.detail).toMatch(/woocommerce_create_refund/);
    expect(calls.find((c) => c.method === "PUT").body).toEqual({ status: "cancelled" });
    expect(calls.find((c) => c.method === "POST").body).toEqual({
      note: "customer asked",
      customer_note: false,
    });
  });

  it("woocommerce_cancel_order and the address change refuse a processing order that already has tracking", async () => {
    const shipped = [
      {
        method: "GET",
        path: `${WC}/orders/12/shipment-trackings`,
        reply: () => ({ status: 404, body: { code: "rest_no_route", message: "No route" } }),
      },
      {
        method: "GET",
        path: `/wp-json/wc-ast/v3/orders/12/shipment-trackings`,
        reply: () => [
          {
            tracking_provider: "DHL",
            tracking_number: "JD1",
            formatted_tracking_link: "https://dhl/JD1",
          },
        ],
      },
    ];
    const { calls } = mockFetch(orderRoutes(ORDER, shipped));
    const res = await server.call("woocommerce_cancel_order", { order_id: "12" });
    expect(res.isError).toBe(true);
    expect(res.error).toMatchObject({
      code: "PRECONDITION",
      retryable: false,
      details: { reason: "ALREADY_SHIPPED", trackingNumbers: ["JD1"] },
    });
    expect(res.error.message).toMatch(/already has shipment tracking \(JD1\)/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    const { calls: calls2 } = mockFetch(orderRoutes(ORDER, shipped));
    const moved = await server.call("woocommerce_update_order_shipping_address", {
      order_id: "12",
      address: { city: "Porto" },
    });
    expect(moved.isError).toBe(true);
    expect(calls2.some((c) => c.method === "PUT")).toBe(false);

    mockFetch(orderRoutes(ORDER, shipped));
    const read = await server.call("woocommerce_get_order", { order_id: "12" });
    expect(read.data.supportSummary).toMatchObject({
      isCancellable: false,
      addressChangeable: false,
    });
    expect(read.data.tracking[0].trackingUrl).toBe("https://dhl/JD1");
  });

  it("woocommerce_cancel_order refuses completed and cancelled orders without writing", async () => {
    const { calls } = mockFetch(orderRoutes({ ...ORDER, status: "completed" }));
    const res = await server.call("woocommerce_cancel_order", { order_id: "12" });
    expect(res.isError).toBe(true);
    expect(res.error.code).toBe("PRECONDITION");
    expect(res.error.message).toMatch(/status "completed"/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    mockFetch(orderRoutes({ ...ORDER, status: "cancelled" }));
    expect((await server.call("woocommerce_cancel_order", { order_id: "12" })).text).toMatch(
      /already cancelled/,
    );
  });

  it("woocommerce_update_order_shipping_address merges fields pre-dispatch and refuses afterwards", async () => {
    const { calls } = mockFetch(
      orderRoutes(ORDER, [
        { method: "PUT", path: `${WC}/orders/12`, reply: ({ body }) => ({ ...ORDER, ...body }) },
      ]),
    );
    const res = await server.call("woocommerce_update_order_shipping_address", {
      order_id: "12",
      address: { address_1: "Rua B 2", postcode: "2000" },
    });
    expect(res.data.shippingAddress).toEqual({
      ...ORDER.shipping,
      address_1: "Rua B 2",
      postcode: "2000",
    });
    expect(calls.find((c) => c.method === "PUT").body).toEqual({
      shipping: res.data.shippingAddress,
    });

    const { calls: calls2 } = mockFetch(orderRoutes({ ...ORDER, status: "completed" }));
    const refused = await server.call("woocommerce_update_order_shipping_address", {
      order_id: "12",
      address: { city: "Porto" },
    });
    expect(refused.isError).toBe(true);
    expect(calls2.some((c) => c.method === "PUT")).toBe(false);
  });

  it("woocommerce_add_order_note posts an internal note by default", async () => {
    const { calls } = mockFetch(
      orderRoutes(ORDER, [
        {
          method: "POST",
          path: `${WC}/orders/12/notes`,
          reply: ({ body }) => ({ id: 55, ...body }),
        },
      ]),
    );
    const res = await server.call("woocommerce_add_order_note", {
      order_number: "12",
      note: "hello",
    });
    expect(res.data).toEqual({ id: 12, number: "12", noteId: 55, note: "hello" });
    expect(calls.find((c) => c.method === "POST").body).toEqual({
      note: "hello",
      customer_note: false,
    });
  });
});

describe("customer tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerCustomerTools(server);
  });

  it("woocommerce_find_customer merges the account and its orders", async () => {
    const account = {
      id: 7,
      email: "ana@example.com",
      first_name: "Ana",
      last_name: "Silva",
      orders_count: 3,
      total_spent: "180.00",
      billing: { phone: "+351912345678" },
    };
    const older = { ...ORDER, id: 3, number: "3", date_created: "2026-01-01T00:00:00" };
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${WC}/customers`,
        reply: ({ query }) => (query.get("email") === "ana@example.com" ? [account] : []),
      },
      {
        method: "GET",
        path: `${WC}/orders`,
        reply: ({ query }) => (query.get("customer") === "7" ? [older, ORDER] : [ORDER]),
      },
    ]);
    const res = await server.call("woocommerce_find_customer", { email: "ana@example.com" });
    expect(res.data).toMatchObject({
      found: true,
      customer: {
        id: 7,
        isGuest: false,
        email: "ana@example.com",
        firstName: "Ana",
        ordersCount: 3,
        totalSpent: "180.00",
      },
    });
    expect(res.data.recentOrders.map((o) => o.id)).toEqual([12, 3]);
    expect(calls.map((c) => c.path)).toEqual([`${WC}/customers`, `${WC}/orders`, `${WC}/orders`]);
  });

  it("woocommerce_find_customer finds guest orders by email or phone and rejects loose search hits", async () => {
    const stranger = {
      ...ORDER,
      id: 99,
      billing: { ...ORDER.billing, email: "other@example.com", phone: "000" },
    };
    mockFetch([
      { method: "GET", path: `${WC}/customers`, reply: () => [] },
      { method: "GET", path: `${WC}/orders`, reply: () => [stranger, ORDER] },
    ]);
    const byEmail = await server.call("woocommerce_find_customer", { email: "ANA@example.com" });
    expect(byEmail.data.customer).toMatchObject({ id: null, isGuest: true, firstName: "Ana" });
    expect(byEmail.data.recentOrders.map((o) => o.id)).toEqual([12]);

    const byPhone = await server.call("woocommerce_find_customer", { phone: "912345678" });
    expect(byPhone.data.recentOrders.map((o) => o.id)).toEqual([12]);
  });

  it("woocommerce_find_customer searches by the formatting-proof tail of the phone number", async () => {
    const { calls } = mockFetch([
      { method: "GET", path: `${WC}/customers`, reply: () => [] },
      {
        method: "GET",
        path: `${WC}/orders`,
        reply: ({ query }) => (query.get("search") === "12345678" ? [ORDER] : []),
      },
    ]);
    const res = await server.call("woocommerce_find_customer", { phone: "+351 (912) 345-678" });
    expect(res.data.found).toBe(true);
    expect(res.data.recentOrders.map((o) => o.id)).toEqual([12]);
    expect(calls.map((c) => c.path)).toEqual([`${WC}/orders`]);
    expect((await server.call("woocommerce_find_customer", { phone: "abc" })).isError).toBe(true);
  });

  it("woocommerce_find_customer reports found=false and requires a key", async () => {
    mockFetch([
      { method: "GET", path: `${WC}/customers`, reply: () => [] },
      { method: "GET", path: `${WC}/orders`, reply: () => [] },
    ]);
    expect((await server.call("woocommerce_find_customer", { email: "x@y.z" })).data.found).toBe(
      false,
    );
    expect((await server.call("woocommerce_find_customer", {})).isError).toBe(true);
  });

  it("woocommerce_list_customer_orders pages by customer id for accounts and verifies guest hits", async () => {
    const stranger = { ...ORDER, id: 99, billing: { ...ORDER.billing, email: "o@example.com" } };
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${WC}/customers`,
        reply: () => [{ id: 7, email: "ana@example.com" }],
      },
      {
        method: "GET",
        path: `${WC}/orders`,
        reply: ({ query }) => (query.get("customer") === "7" ? [ORDER] : [stranger, ORDER]),
      },
    ]);
    const res = await server.call("woocommerce_list_customer_orders", {
      email: "ana@example.com",
      limit: 500,
      page: 2,
    });
    expect(res.data).toEqual({
      items: [expect.objectContaining({ id: 12 })],
      page: 2,
      totalPages: 0,
      total: 0,
    });
    expect(calls[1].query.get("customer")).toBe("7");
    expect(calls[1].query.get("per_page")).toBe("100");
    expect(calls[1].query.has("search")).toBe(false);

    mockFetch([
      { method: "GET", path: `${WC}/customers`, reply: () => [] },
      { method: "GET", path: `${WC}/orders`, reply: () => [stranger, ORDER] },
    ]);
    const guest = await server.call("woocommerce_list_customer_orders", {
      email: "ana@example.com",
    });
    expect(guest.data).toEqual({
      items: [expect.objectContaining({ id: 12 })],
      page: 1,
      totalPages: null,
      total: null,
    });
  });
});

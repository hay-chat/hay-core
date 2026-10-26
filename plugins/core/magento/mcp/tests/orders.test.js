import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerOrderTools } = require("../tools/orders");
const { registerCustomerTools } = require("../tools/customers");
const { enrichOrder, trackingSummary } = require("../lib/orders");
const { searchCriteria } = require("../lib/client");

process.env.MAGENTO_BASE_URL = "https://store.test/rest/V1/";
process.env.MAGENTO_API_TOKEN = "tok";

const ADDRESS = {
  entity_id: 77,
  parent_id: 12,
  address_type: "shipping",
  firstname: "Ana",
  lastname: "Silva",
  street: ["Rua A 1"],
  city: "Lisboa",
  postcode: "1000",
  country_id: "PT",
  telephone: "+351",
};
const ORDER = {
  entity_id: 12,
  increment_id: "000000012",
  status: "processing",
  state: "processing",
  created_at: "2026-10-01 10:00:00",
  order_currency_code: "EUR",
  grand_total: 60,
  subtotal: 50,
  shipping_amount: 5,
  tax_amount: 5,
  discount_amount: 0,
  total_paid: 60,
  total_invoiced: 60,
  total_refunded: 0,
  total_qty_ordered: 2,
  customer_id: 7,
  customer_is_guest: 0,
  customer_email: "ana@example.com",
  customer_firstname: "Ana",
  customer_lastname: "Silva",
  payment: { method: "stripe" },
  shipping_description: "Flat Rate",
  items: [
    {
      item_id: 101,
      sku: "HAT-M",
      name: "Hat",
      product_id: 5,
      qty_ordered: 2,
      qty_shipped: 0,
      qty_invoiced: 2,
      qty_refunded: 0,
      price: 25,
      row_total: 50,
      parent_item_id: null,
    },
    {
      item_id: 102,
      sku: "HAT-M",
      name: "Hat",
      product_id: 6,
      qty_ordered: 2,
      price: 0,
      row_total: 0,
      parent_item_id: 101,
    },
  ],
  extension_attributes: { shipping_assignments: [{ shipping: { address: ADDRESS } }] },
};
const SHIPMENT = {
  entity_id: 9,
  increment_id: "000000009",
  created_at: "2026-10-02 10:00:00",
  tracks: [{ track_number: "JD1", carrier_code: "dhl", title: "DHL" }],
};
const INVOICE = { entity_id: 31, increment_id: "000000031", state: 2, grand_total: 60 };

const V1 = "/rest/V1";
const filterValue = (query, field) => {
  for (const [k, v] of query.entries()) {
    if (/\[field\]$/.test(k) && v === field) return query.get(k.replace("[field]", "[value]"));
  }
  return null;
};

function orderRoutes(order, { shipments = [], invoices = [INVOICE], extra = [] } = {}) {
  return [
    { method: "GET", path: `${V1}/orders/${order.entity_id}`, reply: () => order },
    {
      method: "GET",
      path: `${V1}/orders`,
      reply: ({ query }) => {
        const inc = filterValue(query, "increment_id");
        const email = filterValue(query, "customer_email");
        if (inc)
          return {
            items: inc === order.increment_id ? [order] : [],
            total_count: inc === order.increment_id ? 1 : 0,
          };
        if (email)
          return {
            items: email === order.customer_email ? [order] : [],
            total_count: email === order.customer_email ? 1 : 0,
          };
        return { items: [], total_count: 0 };
      },
    },
    { method: "GET", path: `${V1}/shipments`, reply: () => ({ items: shipments }) },
    { method: "GET", path: `${V1}/invoices`, reply: () => ({ items: invoices }) },
    ...extra,
  ];
}

describe("searchCriteria", () => {
  it("builds AND-ed filter groups with paging and sorting", () => {
    expect(
      searchCriteria(
        [
          { field: "a", value: 1 },
          { field: "b", value: "x", condition: "like" },
        ],
        { pageSize: 5, currentPage: 2, sortField: "created_at" },
      ),
    ).toEqual({
      "searchCriteria[filter_groups][0][filters][0][field]": "a",
      "searchCriteria[filter_groups][0][filters][0][value]": "1",
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "eq",
      "searchCriteria[filter_groups][1][filters][0][field]": "b",
      "searchCriteria[filter_groups][1][filters][0][value]": "x",
      "searchCriteria[filter_groups][1][filters][0][condition_type]": "like",
      "searchCriteria[pageSize]": "5",
      "searchCriteria[currentPage]": "2",
      "searchCriteria[sortOrders][0][field]": "created_at",
      "searchCriteria[sortOrders][0][direction]": "DESC",
    });
  });
});

describe("enrichOrder", () => {
  it("merges order + shipments + invoices and derives the support summary", () => {
    const e = enrichOrder(ORDER, [], [INVOICE]);
    expect(e.supportSummary).toEqual({
      isCancellable: false, // paid/invoiced → Magento cannot cancel
      isRefundable: true,
      remainingRefundable: { amount: "60.00", currency: "EUR" },
      addressChangeable: true,
      shippedAt: null,
      deliveredAt: null,
      needsCreditMemo: true,
    });
    expect(e.lineItems).toHaveLength(1); // child row collapsed
    expect(e.invoices).toEqual([{ id: 31, number: "000000031", state: 2, total: 60 }]);
    expect(e.shippingAddress.city).toBe("Lisboa");
  });

  it("is cancellable while new and unpaid, and locked once shipped", () => {
    const fresh = { ...ORDER, state: "new", status: "pending", total_paid: 0, total_invoiced: 0 };
    expect(enrichOrder(fresh, [], []).supportSummary).toMatchObject({
      isCancellable: true,
      isRefundable: false,
      needsCreditMemo: false,
    });
    // Magento's canCancel() refuses held and payment-review orders.
    expect(enrichOrder({ ...fresh, state: "holded" }, [], []).supportSummary.isCancellable).toBe(
      false,
    );
    const shipped = { ...ORDER, total_refunded: 20 };
    const e = enrichOrder(shipped, [SHIPMENT], [INVOICE]);
    expect(e.supportSummary).toMatchObject({
      isCancellable: false,
      addressChangeable: false,
      remainingRefundable: { amount: "40.00" },
      shippedAt: "2026-10-02 10:00:00",
    });
    expect(e.tracking).toEqual([
      {
        shipmentId: 9,
        shipmentNumber: "000000009",
        shippedAt: "2026-10-02 10:00:00",
        trackingNumber: "JD1",
        carrier: "dhl",
        title: "DHL",
      },
    ]);
  });

  it("lists a shipment without tracks as a row with no number", () => {
    expect(
      trackingSummary([{ entity_id: 1, increment_id: "1", created_at: "d", tracks: [] }]),
    ).toEqual([
      {
        shipmentId: 1,
        shipmentNumber: "1",
        shippedAt: "d",
        trackingNumber: null,
        carrier: null,
        title: null,
      },
    ]);
  });
});

describe("order tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerOrderTools(server);
  });

  it("magento_get_order by number resolves via searchCriteria and merges the reads", async () => {
    const { calls } = mockFetch(orderRoutes(ORDER, { shipments: [SHIPMENT] }));
    const res = await server.call("magento_get_order", { order_number: "#000000012" });
    expect(res.isError).toBe(false);
    expect(res.data.id).toBe(12);
    expect(res.data.tracking[0].trackingNumber).toBe("JD1");
    expect(calls.map((c) => c.path).sort()).toEqual([
      `${V1}/invoices`,
      `${V1}/orders`,
      `${V1}/shipments`,
    ]);
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(filterValue(calls[0].query, "increment_id")).toBe("000000012");
  });

  it("magento_get_order degrades when secondary reads fail and reports unknown orders", async () => {
    mockFetch([
      { method: "GET", path: `${V1}/orders/12`, reply: () => ORDER },
      {
        method: "GET",
        path: `${V1}/shipments`,
        reply: () => ({
          status: 403,
          body: {
            message: "Consumer is not authorized to access %1",
            parameters: ["Magento_Sales::shipment"],
          },
        }),
      },
      { method: "GET", path: `${V1}/invoices`, reply: () => ({ items: [] }) },
      {
        method: "GET",
        path: `${V1}/orders/99`,
        reply: () => ({
          status: 404,
          body: {
            message:
              "The entity that was requested doesn't exist. Verify the entity and try again.",
          },
        }),
      },
      { method: "GET", path: `${V1}/orders`, reply: () => ({ items: [] }) },
    ]);
    const res = await server.call("magento_get_order", { order_id: "12" });
    expect(res.isError).toBe(false);
    expect(res.data.tracking).toEqual([]);
    expect((await server.call("magento_get_order", { order_id: "99" })).text).toMatch(
      /Order 99 not found.*magento_find_customer/,
    );
    expect((await server.call("magento_get_order", { order_number: "5" })).text).toMatch(
      /No order with number 5/,
    );
  });

  it("magento_cancel_order cancels an unpaid new order with a comment", async () => {
    const fresh = { ...ORDER, state: "new", status: "pending", total_paid: 0, total_invoiced: 0 };
    const { calls } = mockFetch(
      orderRoutes(fresh, {
        extra: [
          { method: "POST", path: `${V1}/orders/12/cancel`, reply: () => true },
          { method: "POST", path: `${V1}/orders/12/comments`, reply: () => true },
        ],
      }),
    );
    const res = await server.call("magento_cancel_order", {
      order_id: "12",
      note: "customer asked",
    });
    expect(res.data).toMatchObject({ status: "CANCELLED", number: "000000012" });
    expect(calls.find((c) => c.path.endsWith("/comments")).body).toEqual({
      statusHistory: { comment: "customer asked", is_customer_notified: 0, is_visible_on_front: 0 },
    });
  });

  it("magento_cancel_order refuses paid, shipped-state and cancelled orders without calling Magento", async () => {
    const { calls } = mockFetch(orderRoutes(ORDER));
    const paid = await server.call("magento_cancel_order", { order_id: "12" });
    expect(paid.isError).toBe(true);
    expect(paid.text).toMatch(/invoiced\/paid.*magento_create_refund/);
    expect(calls.some((c) => c.path.endsWith("/cancel"))).toBe(false);

    mockFetch(orderRoutes({ ...ORDER, state: "canceled" }));
    expect((await server.call("magento_cancel_order", { order_id: "12" })).text).toMatch(
      /already cancelled/,
    );
    mockFetch(orderRoutes({ ...ORDER, state: "complete", total_paid: 0, total_invoiced: 0 }));
    expect((await server.call("magento_cancel_order", { order_id: "12" })).text).toMatch(
      /is complete/,
    );
    const { calls: heldCalls } = mockFetch(
      orderRoutes({ ...ORDER, state: "holded", total_paid: 0, total_invoiced: 0 }),
    );
    expect((await server.call("magento_cancel_order", { order_id: "12" })).text).toMatch(
      /on hold.*Unhold/,
    );
    expect(heldCalls.some((c) => c.path.endsWith("/cancel"))).toBe(false);
    mockFetch(orderRoutes({ ...ORDER, state: "payment_review", total_paid: 0, total_invoiced: 0 }));
    expect((await server.call("magento_cancel_order", { order_id: "12" })).text).toMatch(
      /payment review/,
    );
    mockFetch(
      orderRoutes(
        { ...ORDER, state: "new", total_paid: 0, total_invoiced: 0, extra: [] },
        { extra: [{ method: "POST", path: `${V1}/orders/12/cancel`, reply: () => false }] },
      ),
    );
    expect((await server.call("magento_cancel_order", { order_id: "12" })).text).toMatch(
      /Magento refused to cancel/,
    );
  });

  it("magento_update_order_shipping_address merges onto the existing address entity before shipment", async () => {
    const { calls } = mockFetch(
      orderRoutes(ORDER, {
        extra: [{ method: "PUT", path: `${V1}/orders/12`, reply: ({ body }) => body.entity }],
      }),
    );
    const res = await server.call("magento_update_order_shipping_address", {
      order_number: "000000012",
      address: { street: ["Rua B 2"], postcode: "2000" },
    });
    expect(res.isError).toBe(false);
    const put = calls.find((c) => c.method === "PUT");
    expect(put.body.entity).toEqual({ ...ADDRESS, street: ["Rua B 2"], postcode: "2000" });
    expect(res.data.shippingAddress.postcode).toBe("2000");
  });

  it("magento_update_order_shipping_address refuses once a shipment exists", async () => {
    const { calls } = mockFetch(orderRoutes(ORDER, { shipments: [SHIPMENT] }));
    const res = await server.call("magento_update_order_shipping_address", {
      order_id: "12",
      address: { city: "Porto" },
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/already has a shipment/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("magento_add_order_note posts a comment, customer-visible when asked", async () => {
    const { calls } = mockFetch(
      orderRoutes(ORDER, {
        extra: [{ method: "POST", path: `${V1}/orders/12/comments`, reply: () => true }],
      }),
    );
    const res = await server.call("magento_add_order_note", {
      order_id: "12",
      note: "hello",
      customer_note: true,
    });
    expect(res.data).toEqual({ id: 12, number: "000000012", added: true, note: "hello" });
    expect(calls.find((c) => c.method === "POST").body.statusHistory).toEqual({
      comment: "hello",
      is_customer_notified: 1,
      is_visible_on_front: 1,
      status: "processing",
    });
  });
});

describe("customer tools", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerCustomerTools(server);
  });

  it("magento_find_customer merges the account search with the order history", async () => {
    const { calls } = mockFetch([
      {
        method: "GET",
        path: `${V1}/customers/search`,
        reply: () => ({
          items: [{ id: 7, email: "ana@example.com", firstname: "Ana", lastname: "Silva" }],
        }),
      },
      ...orderRoutes(ORDER),
    ]);
    const res = await server.call("magento_find_customer", { email: "ana@example.com" });
    expect(res.data).toMatchObject({
      found: true,
      customer: { id: 7, isGuest: false, firstName: "Ana", ordersCount: 1 },
      recentOrders: [{ id: 12, number: "000000012", status: "processing" }],
    });
    expect(calls.map((c) => c.path).sort()).toEqual([`${V1}/customers/search`, `${V1}/orders`]);
  });

  it("magento_find_customer handles guests and unknown emails", async () => {
    mockFetch([
      { method: "GET", path: `${V1}/customers/search`, reply: () => ({ items: [] }) },
      ...orderRoutes({ ...ORDER, customer_id: null, customer_is_guest: 1 }),
    ]);
    const guest = await server.call("magento_find_customer", { email: "ana@example.com" });
    expect(guest.data.customer).toMatchObject({
      id: null,
      isGuest: true,
      email: "ana@example.com",
    });
    expect((await server.call("magento_find_customer", { email: "x@y.z" })).data.found).toBe(false);
  });

  it("magento_list_customer_orders pages with total_count", async () => {
    mockFetch([
      { method: "GET", path: `${V1}/orders`, reply: () => ({ items: [ORDER], total_count: 23 }) },
    ]);
    const res = await server.call("magento_list_customer_orders", {
      email: "ana@example.com",
      limit: 10,
      page: 2,
    });
    expect(res.data).toEqual({
      items: [expect.objectContaining({ id: 12 })],
      page: 2,
      totalPages: 3,
      total: 23,
    });
  });
});

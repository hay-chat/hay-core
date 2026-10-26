import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { registerRefundTools, buildItems } = require("../tools/refunds");

process.env.MAGENTO_BASE_URL = "https://store.test/rest/V1";
process.env.MAGENTO_API_TOKEN = "tok";

const V1 = "/rest/V1";
const ORDER = {
  entity_id: 12,
  increment_id: "000000012",
  state: "processing",
  order_currency_code: "EUR",
  grand_total: 60,
  shipping_amount: 5,
  total_paid: 60,
  total_invoiced: 60,
  total_refunded: 0,
  payment: { method: "stripe" },
  items: [
    {
      item_id: 101,
      sku: "HAT",
      name: "Hat",
      qty_ordered: 2,
      qty_invoiced: 2,
      qty_refunded: 0,
      parent_item_id: null,
    },
    {
      item_id: 102,
      sku: "SCARF",
      name: "Scarf",
      qty_ordered: 1,
      qty_invoiced: 1,
      qty_refunded: 1,
      parent_item_id: null,
    },
  ],
};
const INVOICE = { entity_id: 31, state: 2 };

function routes(order, { invoices = [INVOICE], onRefund, after } = {}) {
  let reads = 0;
  return [
    {
      method: "GET",
      path: `${V1}/orders/12`,
      reply: () => (reads++ === 0 ? order : after || order),
    },
    { method: "GET", path: `${V1}/invoices`, reply: () => ({ items: invoices }) },
    {
      method: "POST",
      path: /\/(invoice|order)\/\d+\/refund$/,
      reply: (ctx) => (onRefund ? onRefund(ctx) : 501),
    },
  ];
}

describe("buildItems", () => {
  it("maps requested items and bounds quantities by what is still refundable", () => {
    expect(buildItems(ORDER, [{ item_id: "101", quantity: 2 }])).toEqual([
      { order_item_id: 101, qty: 2 },
    ]);
    expect(() => buildItems(ORDER, [{ item_id: "102", quantity: 1 }])).toThrow(/between 1 and 0/);
    expect(() => buildItems(ORDER, [{ item_id: "9", quantity: 1 }])).toThrow(
      /Valid item ids: 101 \(Hat\), 102 \(Scarf\)/,
    );
  });
});

describe("magento_create_refund", () => {
  let server;
  beforeEach(() => {
    server = createFakeServer();
    registerRefundTools(server);
  });

  it("refunds online through the paid invoice by default and reports the delta", async () => {
    const { calls } = mockFetch(routes(ORDER, { after: { ...ORDER, total_refunded: 60 } }));
    const res = await server.call("magento_create_refund", {
      order_id: "12",
      reason: "damaged",
      notify_customer: true,
    });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      refunded: true,
      online: true,
      creditMemoId: 501,
      amount: { amount: "60.00" },
      remainingRefundable: { amount: "0.00" },
    });
    const post = calls.find((c) => c.method === "POST");
    expect(post.path).toBe(`${V1}/invoice/31/refund`);
    expect(post.body).toMatchObject({
      items: [],
      notify: true,
      appendComment: true,
      isOnline: true,
      comment: { comment: "damaged", is_visible_on_front: 0 },
      arguments: { shipping_amount: 0, adjustment_positive: 0, adjustment_negative: 0 },
    });
  });

  it("refunds specific items with restock and shipping", async () => {
    const { calls } = mockFetch(routes(ORDER, { after: { ...ORDER, total_refunded: 55 } }));
    const res = await server.call("magento_create_refund", {
      order_number: undefined,
      order_id: "12",
      items: [{ item_id: "101", quantity: 2 }],
      restock: true,
      refund_shipping: true,
    });
    expect(res.data.amount.amount).toBe("55.00");
    const post = calls.find((c) => c.method === "POST");
    expect(post.body.items).toEqual([{ order_item_id: 101, qty: 2 }]);
    expect(post.body.arguments.shipping_amount).toBe(5);
    expect(post.body.arguments.extension_attributes.return_to_stock_items).toEqual([101]);
  });

  it("books an arbitrary partial amount as a positive adjustment with zero-qty items", async () => {
    const { calls } = mockFetch(routes(ORDER, { after: { ...ORDER, total_refunded: 10 } }));
    const res = await server.call("magento_create_refund", { order_id: "12", amount: "10.00" });
    expect(res.data).toMatchObject({
      amount: { amount: "10.00" },
      remainingRefundable: { amount: "50.00" },
    });
    const post = calls.find((c) => c.method === "POST");
    expect(post.body.items).toEqual([
      { order_item_id: 101, qty: 0 },
      { order_item_id: 102, qty: 0 },
    ]);
    expect(post.body.arguments.adjustment_positive).toBe(10);
  });

  it("caps at paid minus refunded and refuses unpaid, cancelled and fully refunded orders", async () => {
    const { calls } = mockFetch(routes({ ...ORDER, total_refunded: 50 }));
    const tooMuch = await server.call("magento_create_refund", { order_id: "12", amount: "15" });
    expect(tooMuch.text).toMatch(/exceeds the remaining refundable balance of 10.00 EUR/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    mockFetch(routes({ ...ORDER, total_paid: 0, total_invoiced: 0, state: "new" }));
    expect((await server.call("magento_create_refund", { order_id: "12" })).text).toMatch(
      /no recorded payment/,
    );
    mockFetch(routes({ ...ORDER, state: "canceled" }));
    expect((await server.call("magento_create_refund", { order_id: "12" })).text).toMatch(
      /cancelled; nothing to refund/,
    );
    mockFetch(routes({ ...ORDER, total_refunded: 60 }));
    expect((await server.call("magento_create_refund", { order_id: "12" })).text).toMatch(
      /already fully refunded/,
    );
  });

  it("never falls back to offline on its own: no invoice or gateway failure → explicit instruction", async () => {
    const { calls } = mockFetch(routes(ORDER, { invoices: [] }));
    const noInvoice = await server.call("magento_create_refund", { order_id: "12" });
    expect(noInvoice.isError).toBe(true);
    expect(noInvoice.text).toMatch(/no invoice.*online=false/s);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    mockFetch(
      routes(ORDER, {
        onRefund: () => ({
          status: 400,
          body: {
            message: "The refund could not be processed: %1",
            parameters: ["gateway declined"],
          },
        }),
      }),
    );
    const declined = await server.call("magento_create_refund", { order_id: "12" });
    expect(declined.isError).toBe(true);
    expect(declined.text).toMatch(/gateway declined/);
    expect(declined.text).toMatch(/online=false/);
  });

  it("records an offline credit memo against the order when online=false", async () => {
    const { calls } = mockFetch(routes(ORDER, { after: { ...ORDER, total_refunded: 60 } }));
    const res = await server.call("magento_create_refund", { order_id: "12", online: false });
    expect(res.data).toMatchObject({ refunded: true, online: false });
    const post = calls.find((c) => c.method === "POST");
    expect(post.path).toBe(`${V1}/order/12/refund`);
    expect(post.body.isOnline).toBe(false);
    expect(calls.some((c) => c.path === `${V1}/invoices`)).toBe(false);
  });
});

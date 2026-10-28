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
  shipping_refunded: 0,
  total_paid: 60,
  total_invoiced: 60,
  total_refunded: 0,
  payment: { method: "stripe" },
  items: [
    {
      item_id: 101,
      sku: "HAT",
      name: "Hat",
      price: 27.5,
      qty_ordered: 2,
      qty_invoiced: 2,
      qty_refunded: 0,
      parent_item_id: null,
    },
    {
      item_id: 102,
      sku: "SCARF",
      name: "Scarf",
      price: 0,
      qty_ordered: 1,
      qty_invoiced: 1,
      qty_refunded: 1,
      parent_item_id: null,
    },
  ],
};
const INVOICE = { entity_id: 31, state: 2 };

const num = (v) => Number(v) || 0;

/**
 * What Magento's CreditmemoFactory would refund for the posted body: the
 * listed items (all remaining items when the list is empty), the remaining
 * shipping when `shipping_amount` is absent, plus the positive adjustment.
 */
function creditMemoTotal(order, body) {
  const parents = order.items.filter((i) => !i.parent_item_id);
  const items = body.items.length
    ? body.items.reduce((s, i) => {
        const li = parents.find((x) => x.item_id === i.order_item_id);
        return s + i.qty * num(li.price);
      }, 0)
    : parents.reduce(
        (s, li) => s + (num(li.qty_invoiced) - num(li.qty_refunded)) * num(li.price),
        0,
      );
  const shipping =
    body.arguments.shipping_amount === undefined
      ? num(order.shipping_amount) - num(order.shipping_refunded)
      : num(body.arguments.shipping_amount);
  return items + shipping + num(body.arguments.adjustment_positive);
}

function routes(order, { invoices = [INVOICE], onRefund } = {}) {
  let refundedByMemo = 0;
  return [
    {
      method: "GET",
      path: `${V1}/orders/12`,
      reply: () => ({ ...order, total_refunded: num(order.total_refunded) + refundedByMemo }),
    },
    { method: "GET", path: `${V1}/invoices`, reply: () => ({ items: invoices }) },
    {
      method: "POST",
      path: /\/(invoice|order)\/\d+\/refund$/,
      reply: (ctx) => {
        if (onRefund) return onRefund(ctx);
        refundedByMemo += creditMemoTotal(order, ctx.body);
        return 501;
      },
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

  it("refuses a currency that is not the order's, before refunding", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("magento_create_refund", { currency: "USD", order_id: "12" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/is in EUR, not USD/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("refunds online through the paid invoice by default, shipping included, and reports the delta", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("magento_create_refund", {
      currency: "EUR",
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
      arguments: { adjustment_positive: 0, adjustment_negative: 0 },
    });
    // Absent on purpose: Magento then refunds the remaining shipping itself.
    expect(post.body.arguments).not.toHaveProperty("shipping_amount");
  });

  it("full refund without shipping when refund_shipping=false", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
      refund_shipping: false,
    });
    expect(res.data.amount.amount).toBe("55.00");
    expect(res.data.remainingRefundable.amount).toBe("5.00");
    expect(calls.find((c) => c.method === "POST").body.arguments.shipping_amount).toBe(0);
  });

  it("refunds specific items with restock and the remaining shipping", async () => {
    const { calls } = mockFetch(routes({ ...ORDER, shipping_refunded: 3, total_refunded: 3 }));
    const res = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
      items: [{ item_id: "101", quantity: 2 }],
      restock: true,
      refund_shipping: true,
    });
    expect(res.data.amount.amount).toBe("57.00");
    const post = calls.find((c) => c.method === "POST");
    expect(post.body.items).toEqual([{ order_item_id: 101, qty: 2 }]);
    expect(post.body.arguments.shipping_amount).toBe(2);
    expect(post.body.arguments.extension_attributes.return_to_stock_items).toEqual([101]);

    const { calls: calls2 } = mockFetch(routes(ORDER));
    await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
      items: [{ item_id: "101", quantity: 1 }],
    });
    expect(calls2.find((c) => c.method === "POST").body.arguments.shipping_amount).toBe(0);
  });

  it("books an arbitrary partial amount as a positive adjustment with zero-qty items", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
      amount: "10.00",
    });
    expect(res.data).toMatchObject({
      amount: { amount: "10.00" },
      remainingRefundable: { amount: "50.00" },
    });
    const post = calls.find((c) => c.method === "POST");
    expect(post.body.items).toEqual([
      { order_item_id: 101, qty: 0 },
      { order_item_id: 102, qty: 0 },
    ]);
    expect(post.body.arguments.shipping_amount).toBe(0);
    expect(post.body.arguments.adjustment_positive).toBe(10);
  });

  it("caps at paid minus refunded and refuses unpaid, cancelled and fully refunded orders", async () => {
    const { calls } = mockFetch(routes({ ...ORDER, total_refunded: 50 }));
    const tooMuch = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
      amount: "15",
    });
    expect(tooMuch.text).toMatch(/exceeds the remaining refundable balance of 10.00 EUR/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    mockFetch(routes({ ...ORDER, total_paid: 0, total_invoiced: 0, state: "new" }));
    expect(
      (await server.call("magento_create_refund", { currency: "EUR", order_id: "12" })).text,
    ).toMatch(/no recorded payment/);
    mockFetch(routes({ ...ORDER, state: "canceled" }));
    expect(
      (await server.call("magento_create_refund", { currency: "EUR", order_id: "12" })).text,
    ).toMatch(/cancelled; nothing to refund/);
    mockFetch(routes({ ...ORDER, total_refunded: 60 }));
    expect(
      (await server.call("magento_create_refund", { currency: "EUR", order_id: "12" })).text,
    ).toMatch(/already fully refunded/);
  });

  it("never falls back to offline on its own: no paid invoice or gateway failure → explicit instruction", async () => {
    const { calls } = mockFetch(routes(ORDER, { invoices: [] }));
    const noInvoice = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
    });
    expect(noInvoice.isError).toBe(true);
    expect(noInvoice.text).toMatch(/no paid invoice.*online=false/s);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    // An open (1) or canceled (3) invoice is not something money can go back through.
    const { calls: calls2 } = mockFetch(
      routes(ORDER, {
        invoices: [
          { entity_id: 30, state: 1 },
          { entity_id: 32, state: 3 },
        ],
      }),
    );
    expect(
      (await server.call("magento_create_refund", { currency: "EUR", order_id: "12" })).text,
    ).toMatch(/no paid invoice/);
    expect(calls2.some((c) => c.method === "POST")).toBe(false);

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
    const declined = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
    });
    expect(declined.isError).toBe(true);
    expect(declined.text).toMatch(/gateway declined/);
    expect(declined.text).toMatch(/online=false/);
  });

  it("records an offline credit memo against the order when online=false", async () => {
    const { calls } = mockFetch(routes(ORDER));
    const res = await server.call("magento_create_refund", {
      currency: "EUR",
      order_id: "12",
      online: false,
    });
    expect(res.data).toMatchObject({ refunded: true, online: false, amount: { amount: "60.00" } });
    const post = calls.find((c) => c.method === "POST");
    expect(post.path).toBe(`${V1}/order/12/refund`);
    expect(post.body.isOnline).toBe(false);
    expect(calls.some((c) => c.path === `${V1}/invoices`)).toBe(false);
  });
});

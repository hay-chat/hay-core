import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE, makeOrder, makeFulfillment, orderRoutes } = require("./fixtures");
const { createFakeServer, mockFetch } = require("./harness");
const { registerOrderTools } = require("../tools/orders");
const { dispatchState, normalizeFulfillment, paymentInfo } = require("../lib/orders");

let server;
beforeEach(() => {
  server = createFakeServer();
  registerOrderTools(server);
});

describe("nuvemshop_get_order", () => {
  it("resolves the customer-facing number exactly, never a lookalike", async () => {
    const order = makeOrder();
    mockFetch(orderRoutes(order));
    const res = await server.call("nuvemshop_get_order", { order_number: "#101" });
    expect(res.isError).toBe(false);
    expect(res.data.id).toBe(900);
    expect(res.data.number).toBe(101);
  });

  it("refuses an order number with no exact match", async () => {
    mockFetch(orderRoutes(makeOrder()));
    const res = await server.call("nuvemshop_get_order", { order_number: "10" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No order with number #10/);
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns a projection with payment, Pix status, tracking and supportSummary", async () => {
    const order = makeOrder({ payment_status: "pending", paid_at: null });
    mockFetch(orderRoutes(order));
    const { data } = await server.call("nuvemshop_get_order", { order_id: "900" });
    expect(data.payment).toMatchObject({
      method: "pix",
      isPix: true,
      pixStatus: "awaiting_payment",
      awaitingPayment: true,
      gatewayName: "Nuvem Pago",
    });
    expect(data.supportSummary).toMatchObject({
      isCancellable: true,
      addressChangeable: true,
      isPaid: false,
      refundCanBeExecutedByAgent: false,
    });
    expect(data.tracking[0]).toMatchObject({
      status: "UNPACKED",
      carrier: "Correios",
      shippingOption: "PAC",
    });
    expect(data).not.toHaveProperty("gateway_link");
    expect(data).not.toHaveProperty("client_details");
  });

  it("reads tracking, delivery and transaction refunds", async () => {
    const order = makeOrder({ shipping_status: "delivered", payment_status: "partially_refunded" });
    mockFetch(
      orderRoutes(order, {
        fulfillments: [
          makeFulfillment({
            status: "DELIVERED",
            tracking_info: { code: "QB123BR", url: "https://rastreio.test/QB123BR" },
            tracking_events: [
              { status: "dispatched", happened_at: "2026-10-21T09:00:00Z" },
              { status: "delivered", happened_at: "2026-10-24T15:00:00Z" },
            ],
          }),
        ],
        transactions: [
          { id: "t1", status: "partially_refunded", refunded_amount: { value: "20.00" } },
        ],
      }),
    );
    const { data } = await server.call("nuvemshop_get_order", { order_id: "900" });
    expect(data.tracking[0]).toMatchObject({
      trackingNumber: "QB123BR",
      trackingUrl: "https://rastreio.test/QB123BR",
    });
    expect(data.supportSummary).toMatchObject({
      isCancellable: false,
      addressChangeable: false,
      shippedAt: "2026-10-21T09:00:00Z",
      deliveredAt: "2026-10-24T15:00:00Z",
      refundState: "partially_refunded",
      remainingRefundable: { amount: "100.00", currency: "BRL" },
    });
    expect(data.totals.refunded).toBe("20.00");
  });

  it("falls back to legacy order tracking fields when fulfillment orders are unavailable", async () => {
    const order = makeOrder({
      shipping_tracking_number: "LEG1",
      shipping_tracking_url: "https://t/LEG1",
    });
    mockFetch(
      orderRoutes(order, {
        extra: [
          {
            method: "GET",
            path: `${BASE}/orders/900/fulfillment-orders`,
            reply: () => ({ status: 404, body: {} }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_get_order_tracking", { order_id: "900" });
    expect(res.data.tracking).toEqual([
      expect.objectContaining({ trackingNumber: "LEG1", trackingUrl: "https://t/LEG1" }),
    ]);
  });

  it("remainingRefundable is unknown for a partial refund without transactions", async () => {
    mockFetch(orderRoutes(makeOrder({ payment_status: "partially_refunded" })));
    const { data } = await server.call("nuvemshop_get_order", { order_id: "900" });
    expect(data.supportSummary.remainingRefundable).toBeNull();
  });
});

describe("dispatchState", () => {
  const fo = (o) => normalizeFulfillment(makeFulfillment(o));
  it("is pre-dispatch only with open status, no tracking, no label, pre-dispatch fulfillment", () => {
    expect(dispatchState(makeOrder(), [fo()]).preDispatch).toBe(true);
    expect(dispatchState(makeOrder(), [fo({ status: "PACKED" })]).preDispatch).toBe(true);
    expect(dispatchState(makeOrder(), [fo({ status: "DISPATCHED" })]).preDispatch).toBe(false);
    expect(dispatchState(makeOrder(), [fo({ tracking_info: { code: "X1" } })]).reason).toMatch(
      /tracking X1/,
    );
    expect(dispatchState(makeOrder(), [fo({ labels: [{ id: 1 }] })]).reason).toMatch(/label/);
    expect(dispatchState(makeOrder({ shipping_status: "shipped" }), []).preDispatch).toBe(false);
    expect(dispatchState(makeOrder({ status: "closed" }), []).preDispatch).toBe(false);
  });
});

describe("paymentInfo", () => {
  it("maps Pix states and card details", () => {
    expect(paymentInfo(makeOrder({ payment_status: "abandoned" })).pixStatus).toBe(
      "expired_or_abandoned",
    );
    const card = paymentInfo(
      makeOrder({
        payment_details: { method: "credit_card", credit_card_company: "visa", installments: 3 },
      }),
    );
    expect(card).toMatchObject({
      isPix: false,
      pixStatus: null,
      cardBrand: "visa",
      installments: 3,
    });
  });
});

describe("nuvemshop_cancel_order", () => {
  it("refuses once tracking is recorded, without calling cancel", async () => {
    const { calls } = mockFetch(
      orderRoutes(makeOrder(), {
        fulfillments: [makeFulfillment({ tracking_info: { code: "QB1" } })],
      }),
    );
    const res = await server.call("nuvemshop_cancel_order", {
      order_id: "900",
      reason: "customer",
      confirm_paid_cancellation: true,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/tracking QB1/);
    expect(res.error.code).toBe("PRECONDITION");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("requires confirm_paid_cancellation on a paid order", async () => {
    const { calls } = mockFetch(orderRoutes(makeOrder()));
    const res = await server.call("nuvemshop_cancel_order", {
      order_id: "900",
      reason: "customer",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/will NOT refund/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("cancels with reason/email/restock and reports that no money moved", async () => {
    const order = makeOrder();
    const { calls } = mockFetch(
      orderRoutes(order, {
        extra: [
          {
            method: "POST",
            path: `${BASE}/orders/900/cancel`,
            reply: () => ({ ...order, status: "cancelled" }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_cancel_order", {
      order_id: "900",
      reason: "customer",
      restock: false,
      confirm_paid_cancellation: true,
    });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ status: "CANCELLED", moneyMoved: false, restocked: false });
    expect(res.data.detail).toMatch(/nuvemshop_request_refund/);
    const post = calls.find((c) => c.method === "POST");
    expect(post.body).toEqual({ reason: "customer", email: true, restock: false });
  });

  it("refuses an already-cancelled order", async () => {
    mockFetch(orderRoutes(makeOrder({ status: "cancelled" })));
    const res = await server.call("nuvemshop_cancel_order", { order_id: "900", reason: "other" });
    expect(res.text).toMatch(/already cancelled/);
  });
});

describe("nuvemshop_update_order_shipping_address", () => {
  it("PATCHes the fulfillment order destination, keeping untouched fields", async () => {
    const { calls } = mockFetch(
      orderRoutes(makeOrder(), {
        extra: [
          {
            method: "PATCH",
            path: `${BASE}/orders/900/fulfillment-orders/01FO`,
            reply: ({ body }) => ({ ...makeFulfillment(), ...body }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_update_order_shipping_address", {
      order_id: "900",
      address: {
        street: "Rua B",
        number: "22",
        province_code: "RJ",
        recipient_phone: "21999990000",
      },
    });
    expect(res.isError).toBe(false);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.destination).toMatchObject({
      street: "Rua B",
      number: "22",
      zipcode: "01000-000",
      city: "São Paulo",
      province: { code: "RJ" },
      country: { code: "BR" },
    });
    expect(patch.body.recipient).toEqual({ name: "Ana Souza", phone: "21999990000" });
  });

  it("refuses after dispatch and for pickup", async () => {
    mockFetch(
      orderRoutes(makeOrder(), { fulfillments: [makeFulfillment({ status: "DISPATCHED" })] }),
    );
    let res = await server.call("nuvemshop_update_order_shipping_address", {
      order_id: "900",
      address: { city: "X" },
    });
    expect(res.text).toMatch(/fulfillment status is DISPATCHED/);

    const { calls } = mockFetch(
      orderRoutes(makeOrder(), {
        fulfillments: [makeFulfillment({ shipping: { type: "pickup" } })],
      }),
    );
    res = await server.call("nuvemshop_update_order_shipping_address", {
      order_id: "900",
      address: { city: "X" },
    });
    expect(res.text).toMatch(/no shippable fulfillment order/);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("nuvemshop_add_order_note", () => {
  it("appends to the existing owner note instead of replacing it", async () => {
    const order = makeOrder({ owner_note: "Gift wrap" });
    const { calls } = mockFetch(
      orderRoutes(order, {
        extra: [
          {
            method: "PUT",
            path: `${BASE}/orders/900`,
            reply: ({ body }) => ({ ...order, ...body }),
          },
        ],
      }),
    );
    const res = await server.call("nuvemshop_add_order_note", {
      order_id: "900",
      note: "Customer asked for an update",
    });
    const put = calls.find((c) => c.method === "PUT");
    expect(put.body.owner_note).toMatch(/^Gift wrap\n\[Hay .* UTC\] Customer asked for an update$/);
    expect(res.data.ownerNote).toBe(put.body.owner_note);
  });
});

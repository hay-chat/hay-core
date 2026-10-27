import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BASE, makeOrder, orderRoutes } = require("./fixtures");
const { createFakeServer, mockFetch } = require("./harness");
const { registerRefundTools } = require("../tools/refunds");

let server;
beforeEach(() => {
  server = createFakeServer();
  registerRefundTools(server);
});

const putRoute = (order) => ({
  method: "PUT",
  path: `${BASE}/orders/${order.id}`,
  reply: ({ body }) => ({ ...order, ...body }),
});

describe("nuvemshop_check_refund_status", () => {
  it("reports refund events with dates and never claims the agent can refund", async () => {
    const order = makeOrder({ payment_status: "partially_refunded" });
    mockFetch(
      orderRoutes(order, {
        transactions: [
          {
            id: "t1",
            status: "partially_refunded",
            refunded_amount: { value: "30.00" },
            events: [
              { type: "sale", status: "success" },
              {
                type: "refund",
                status: "success",
                amount: { value: "30.00", currency: "BRL" },
                happened_at: "2026-10-22T12:00:00Z",
              },
            ],
          },
        ],
      }),
    );
    const { data } = await server.call("nuvemshop_check_refund_status", { order_id: "900" });
    expect(data).toMatchObject({
      refundState: "partially_refunded",
      paymentMethod: "pix",
      paymentProvider: "Nuvem Pago",
      refunded: { amount: "30.00", currency: "BRL" },
      transactionsAvailable: true,
      refundCanBeExecutedByAgent: false,
    });
    expect(data.refundEvents).toEqual([
      {
        transactionId: "t1",
        status: "success",
        amount: "30.00",
        currency: "BRL",
        happenedAt: "2026-10-22T12:00:00Z",
      },
    ]);
    expect(data.howToRefund).toMatch(/cannot move money/);
  });

  it("degrades to order fields when transactions are refused", async () => {
    mockFetch(orderRoutes(makeOrder()));
    const { data } = await server.call("nuvemshop_check_refund_status", { order_id: "900" });
    expect(data.transactionsAvailable).toBe(false);
    expect(data.refunded).toBeNull();
  });
});

describe("nuvemshop_request_refund", () => {
  it("records a full refund request on the order and says no money moved", async () => {
    const order = makeOrder({ owner_note: "VIP" });
    const { calls } = mockFetch(orderRoutes(order, { extra: [putRoute(order)] }));
    const res = await server.call("nuvemshop_request_refund", {
      order_number: "101",
      reason: "Arrived damaged",
    });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      refundRequested: true,
      moneyMoved: false,
      handoff: true,
      amount: { amount: "120.00", currency: "BRL" },
      paymentProvider: "Nuvem Pago",
    });
    const put = calls.find((c) => c.method === "PUT");
    expect(put.body.owner_note).toMatch(
      /^VIP\n.*REFUND REQUESTED: 120\.00 BRL via Nuvem Pago\. Reason: Arrived damaged/,
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("caps at the remaining balance when transactions show earlier refunds", async () => {
    const order = makeOrder({ payment_status: "partially_refunded" });
    const { calls } = mockFetch(
      orderRoutes(order, {
        transactions: [{ id: "t1", refunded_amount: "100.00" }],
        extra: [putRoute(order)],
      }),
    );
    const res = await server.call("nuvemshop_request_refund", {
      order_id: "900",
      amount: "30",
      reason: "late",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/exceeds the remaining balance of 20\.00 BRL/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("refuses unpaid, authorized and fully refunded orders", async () => {
    for (const [status, re] of [
      ["pending", /no captured payment/],
      ["authorized", /card hold/],
      ["refunded", /already fully refunded/],
    ]) {
      mockFetch(orderRoutes(makeOrder({ payment_status: status })));
      const res = await server.call("nuvemshop_request_refund", {
        order_id: "900",
        reason: "why not",
      });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(re);
    }
  });

  it("refuses an amount above the order total", async () => {
    mockFetch(orderRoutes(makeOrder()));
    const res = await server.call("nuvemshop_request_refund", {
      order_id: "900",
      amount: "500",
      reason: "late",
    });
    expect(res.text).toMatch(/exceeds the order total of 120\.00 BRL/);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockShopify } = require("./harness");
const { registerOrderTools, cancelBlocker } = require("../tools/orders");
const { registerFulfillmentTools } = require("../tools/fulfillments");

const ORDER_GID = "gid://shopify/Order/1001";

function unfulfilledOrder(overrides = {}) {
  return {
    id: ORDER_GID,
    name: "#1001",
    cancelledAt: null,
    displayFulfillmentStatus: "UNFULFILLED",
    fulfillments: [],
    ...overrides,
  };
}

let server;
beforeEach(() => {
  server = createFakeServer();
  registerOrderTools(server);
  registerFulfillmentTools(server);
});

describe("cancelBlocker", () => {
  it("allows unfulfilled, scheduled and on-hold orders", () => {
    for (const status of ["UNFULFILLED", "SCHEDULED", "ON_HOLD"]) {
      expect(cancelBlocker(unfulfilledOrder({ displayFulfillmentStatus: status }))).toBeNull();
    }
  });

  it("ignores cancelled or failed fulfillments", () => {
    const order = unfulfilledOrder({
      fulfillments: [
        { status: "CANCELLED", displayStatus: "CANCELED" },
        { status: "FAILURE", displayStatus: "FAILURE" },
      ],
    });
    expect(cancelBlocker(order)).toBeNull();
  });

  it("refuses when any fulfillment shipped, even if the order reads partially fulfilled", () => {
    const order = unfulfilledOrder({
      displayFulfillmentStatus: "PARTIALLY_FULFILLED",
      fulfillments: [{ status: "SUCCESS", displayStatus: "IN_TRANSIT" }],
    });
    expect(cancelBlocker(order)).toMatchObject({
      reason: "ALREADY_SHIPPED",
      fulfillmentStatuses: ["IN_TRANSIT"],
    });
  });

  it("refuses an order handed to a fulfillment service", () => {
    expect(
      cancelBlocker(unfulfilledOrder({ displayFulfillmentStatus: "IN_PROGRESS" })),
    ).toMatchObject({ reason: "FULFILLMENT_IN_PROGRESS" });
  });

  it("refuses an already-cancelled order", () => {
    expect(cancelBlocker(unfulfilledOrder({ cancelledAt: "2026-10-01T00:00:00Z" }))).toMatchObject({
      reason: "ALREADY_CANCELLED",
    });
  });
});

describe("shopify_cancel_order", () => {
  const CANCEL_OK = {
    orderCancel: {
      job: { id: "gid://shopify/Job/1", done: false },
      orderCancelUserErrors: [],
      userErrors: [],
    },
  };

  it("refuses a shipped order with a structured PRECONDITION error and never calls orderCancel", async () => {
    const { calls } = mockShopify({
      CheckCancellable: () => ({
        order: unfulfilledOrder({
          displayFulfillmentStatus: "FULFILLED",
          fulfillments: [{ status: "SUCCESS", displayStatus: "IN_TRANSIT" }],
        }),
      }),
    });
    const res = await server.call("shopify_cancel_order", {
      order_id: "1001",
      reason: "CUSTOMER",
      restock: true,
    });
    expect(res.isError).toBe(true);
    expect(res.data).toMatchObject({
      code: "PRECONDITION",
      retryable: false,
      details: { reason: "ALREADY_SHIPPED", fulfillmentStatuses: ["IN_TRANSIT"] },
    });
    expect(res.data.message).toMatch(/already shipped/);
    expect(calls.map((c) => c.op)).toEqual(["CheckCancellable"]);
    expect(calls[0].variables).toEqual({ id: ORDER_GID });
  });

  it("returns NOT_FOUND for an unknown order", async () => {
    mockShopify({
      CheckCancellable: () => ({ order: null }),
      ProbeCustomer: () => ({ customer: null }),
    });
    const res = await server.call("shopify_cancel_order", {
      order_id: "1001",
      reason: "CUSTOMER",
      restock: true,
    });
    expect(res.data).toMatchObject({ code: "NOT_FOUND" });
  });

  it("cancels an unfulfilled order with an explicit no-refund method by default", async () => {
    const { calls } = mockShopify({
      CheckCancellable: () => ({ order: unfulfilledOrder() }),
      CancelOrder: () => CANCEL_OK,
    });
    const res = await server.call("shopify_cancel_order", {
      order_id: "1001",
      reason: "CUSTOMER",
      restock: true,
    });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("CANCELLATION_ACCEPTED");
    const cancel = calls.find((c) => c.op === "CancelOrder");
    expect(cancel.variables).toEqual({
      orderId: ORDER_GID,
      reason: "CUSTOMER",
      restock: true,
      refundMethod: { originalPaymentMethodsRefund: false },
      notify: null,
      note: null,
    });
    // Documented 2026-04 argument names.
    expect(cancel.query).toMatch(/refundMethod: \$refundMethod/);
    expect(cancel.query).toMatch(/notifyCustomer: \$notify/);
    expect(cancel.query).toMatch(/staffNote: \$note/);
  });

  it("passes originalPaymentMethodsRefund: true when a refund is requested", async () => {
    const { calls } = mockShopify({
      CheckCancellable: () => ({
        order: unfulfilledOrder({ displayFulfillmentStatus: "ON_HOLD" }),
      }),
      CancelOrder: () => CANCEL_OK,
    });
    await server.call("shopify_cancel_order", {
      order_id: ORDER_GID,
      reason: "CUSTOMER",
      restock: false,
      refund_to_original_payment: true,
      notify_customer: true,
      staff_note: "Customer changed their mind",
    });
    const cancel = calls.find((c) => c.op === "CancelOrder");
    expect(cancel.variables).toMatchObject({
      refundMethod: { originalPaymentMethodsRefund: true },
      notify: true,
      note: "Customer changed their mind",
    });
  });

  it("still surfaces Shopify's own refusal", async () => {
    mockShopify({
      CheckCancellable: () => ({ order: unfulfilledOrder() }),
      CancelOrder: () => ({
        orderCancel: {
          job: null,
          orderCancelUserErrors: [{ field: null, message: "Has open return", code: "INVALID" }],
          userErrors: [],
        },
      }),
    });
    const res = await server.call("shopify_cancel_order", {
      order_id: "1001",
      reason: "CUSTOMER",
      restock: true,
    });
    expect(res.isError).toBe(true);
    expect(res.data).toMatchObject({
      code: "PROVIDER_REFUSED",
      message: "Shopify refused: Has open return",
    });
  });
});

describe("shopify_add_order_note", () => {
  it("appends to the existing note instead of replacing it", async () => {
    const { calls } = mockShopify({
      GetOrderNote: () => ({ order: { id: ORDER_GID, name: "#1001", note: "Gift wrap please" } }),
      AddOrderNote: (vars) => ({
        orderUpdate: { order: { id: ORDER_GID, note: vars.note }, userErrors: [] },
      }),
    });
    const res = await server.call("shopify_add_order_note", {
      order_id: "1001",
      note: "  Customer asked about delivery date.  ",
    });
    expect(res.isError).toBe(false);
    const update = calls.find((c) => c.op === "AddOrderNote");
    expect(update.variables).toEqual({
      id: ORDER_GID,
      note: "Gift wrap please\n\nCustomer asked about delivery date.",
    });
    expect(res.data).toMatchObject({ appended: true });
  });

  it("writes the note as-is when the order has none", async () => {
    const { calls } = mockShopify({
      GetOrderNote: () => ({ order: { id: ORDER_GID, name: "#1001", note: null } }),
      AddOrderNote: (vars) => ({
        orderUpdate: { order: { id: ORDER_GID, note: vars.note }, userErrors: [] },
      }),
    });
    await server.call("shopify_add_order_note", { order_id: "1001", note: "First note" });
    expect(calls.find((c) => c.op === "AddOrderNote").variables.note).toBe("First note");
  });

  it("does not append the same text twice on a retry", async () => {
    const { calls } = mockShopify({
      GetOrderNote: () => ({
        order: { id: ORDER_GID, name: "#1001", note: "Old\n\nCustomer asked about delivery date." },
      }),
    });
    const res = await server.call("shopify_add_order_note", {
      order_id: "1001",
      note: "Customer asked about delivery date.",
    });
    expect(res.data).toMatchObject({ appended: false, alreadyPresent: true });
    expect(calls.map((c) => c.op)).toEqual(["GetOrderNote"]);
  });

  it("refuses an empty note without calling Shopify", async () => {
    const { calls } = mockShopify({});
    const res = await server.call("shopify_add_order_note", { order_id: "1001", note: "   " });
    expect(res.data).toMatchObject({ code: "BAD_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("returns NOT_FOUND for an unknown order", async () => {
    mockShopify({
      GetOrderNote: () => ({ order: null }),
      ProbeCustomer: () => ({ customer: null }),
    });
    const res = await server.call("shopify_add_order_note", { order_id: "999", note: "x" });
    expect(res.data).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("shopify_get_order_tracking", () => {
  it("returns NOT_FOUND instead of null for an unknown order", async () => {
    mockShopify({
      GetOrderTracking: () => ({ order: null }),
      ProbeCustomer: () => ({ customer: null }),
    });
    const res = await server.call("shopify_get_order_tracking", { order_id: "999" });
    expect(res.isError).toBe(true);
    expect(res.data).toMatchObject({ code: "NOT_FOUND" });
    expect(res.data.message).toMatch(/Order 999 not found/);
  });

  it("names the customer when a customer id was passed by mistake", async () => {
    mockShopify({
      GetOrderTracking: () => ({ order: null }),
      ProbeCustomer: () => ({ customer: { id: "gid://shopify/Customer/7", displayName: "Ana" } }),
    });
    const res = await server.call("shopify_get_order_tracking", { order_id: "7" });
    expect(res.data).toMatchObject({ code: "NOT_FOUND" });
    expect(res.data.message).toMatch(/belongs to customer "Ana"/);
  });

  it("says NOT_SHIPPED when nothing has shipped", async () => {
    mockShopify({
      GetOrderTracking: () => ({
        order: {
          id: ORDER_GID,
          name: "#1001",
          displayFulfillmentStatus: "UNFULFILLED",
          fulfillments: [],
        },
      }),
    });
    const res = await server.call("shopify_get_order_tracking", { order_id: "1001" });
    expect(res.data).toMatchObject({ trackingState: "NOT_SHIPPED", trackingSummary: [] });
  });

  it("says SHIPPED_NO_TRACKING when shipped without a tracking number", async () => {
    mockShopify({
      GetOrderTracking: () => ({
        order: {
          id: ORDER_GID,
          name: "#1001",
          displayFulfillmentStatus: "FULFILLED",
          fulfillments: [{ status: "SUCCESS", displayStatus: "FULFILLED", trackingInfo: [] }],
        },
      }),
    });
    const res = await server.call("shopify_get_order_tracking", { order_id: "1001" });
    expect(res.data.trackingState).toBe("SHIPPED_NO_TRACKING");
  });

  it("flattens tracking info", async () => {
    mockShopify({
      GetOrderTracking: () => ({
        order: {
          id: ORDER_GID,
          name: "#1001",
          displayFulfillmentStatus: "FULFILLED",
          fulfillments: [
            {
              status: "SUCCESS",
              displayStatus: "IN_TRANSIT",
              deliveredAt: null,
              estimatedDeliveryAt: "2026-10-30T00:00:00Z",
              trackingInfo: [{ number: "1Z999", url: "https://ups.test/1Z999", company: "UPS" }],
            },
          ],
        },
      }),
    });
    const res = await server.call("shopify_get_order_tracking", { order_id: "1001" });
    expect(res.data.trackingState).toBe("HAS_TRACKING");
    expect(res.data.trackingSummary).toEqual([
      {
        status: "SUCCESS",
        displayStatus: "IN_TRANSIT",
        deliveredAt: null,
        estimatedDeliveryAt: "2026-10-30T00:00:00Z",
        number: "1Z999",
        url: "https://ups.test/1Z999",
        company: "UPS",
      },
    ]);
  });
});

describe("shopify_get_order supportSummary", () => {
  it("marks a partially shipped order as not cancellable", async () => {
    mockShopify({
      GetOrder: () => ({
        order: {
          ...unfulfilledOrder({
            displayFulfillmentStatus: "PARTIALLY_FULFILLED",
            fulfillments: [{ status: "SUCCESS", displayStatus: "IN_TRANSIT", deliveredAt: null }],
          }),
          closedAt: null,
          refundable: true,
          netPaymentSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
          lineItems: { edges: [] },
        },
      }),
    });
    const res = await server.call("shopify_get_order", { order_id: "1001" });
    expect(res.data.supportSummary).toMatchObject({
      isCancellable: false,
      addressChangeable: false,
    });
  });
});

describe("shopify_get_order payment and source fields (D10-1)", () => {
  it("requests and flattens transactions, refunds, sourceName, tags and custom attributes", async () => {
    const { calls } = mockShopify({
      GetOrder: () => ({
        order: unfulfilledOrder({
          refundable: true,
          lineItems: { edges: [] },
          sourceName: "bling",
          tags: ["mercadolivre"],
          customAttributes: [{ key: "cpf", value: "000" }],
          paymentGatewayNames: ["Mercado Pago"],
          transactions: [
            {
              id: "gid://shopify/OrderTransaction/1",
              kind: "SALE",
              status: "SUCCESS",
              gateway: "mercado_pago",
              formattedGateway: "Mercado Pago",
              paymentId: "123456789",
              processedAt: "2026-10-01T10:00:00Z",
              amountSet: { shopMoney: { amount: "99.90", currencyCode: "BRL" } },
            },
          ],
          refunds: [
            {
              id: "gid://shopify/Refund/9",
              createdAt: "2026-10-03T12:00:00Z",
              note: null,
              totalRefundedSet: { shopMoney: { amount: "10.00", currencyCode: "BRL" } },
            },
          ],
        }),
      }),
    });
    const res = await server.call("shopify_get_order", { order_id: "1001" });
    for (const field of [
      "sourceName",
      "paymentGatewayNames",
      "paymentId",
      "createdAt",
      "customAttributes",
    ]) {
      expect(calls[0].query).toContain(field);
    }
    expect(res.data).toMatchObject({
      sourceName: "bling",
      tags: ["mercadolivre"],
      customAttributes: [{ key: "cpf", value: "000" }],
      paymentGatewayNames: ["Mercado Pago"],
      transactions: [
        {
          formattedGateway: "Mercado Pago",
          paymentId: "123456789",
          amount: { amount: "99.90", currencyCode: "BRL" },
        },
      ],
      refunds: [{ createdAt: "2026-10-03T12:00:00Z", totalRefunded: { amount: "10.00" } }],
    });
    expect(res.data.transactions[0].amountSet).toBeUndefined();
  });

  it("defaults missing payment fields to empty values", async () => {
    mockShopify({ GetOrder: () => ({ order: unfulfilledOrder({ lineItems: { edges: [] } }) }) });
    const res = await server.call("shopify_get_order", { order_id: "1001" });
    expect(res.data).toMatchObject({
      sourceName: null,
      tags: [],
      customAttributes: [],
      paymentGatewayNames: [],
      transactions: [],
      refunds: [],
    });
  });
});

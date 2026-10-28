/**
 * Order tools — rich reads, narrow bounded writes.
 *
 *   nuvemshop_get_order                      GET /orders/{id} | ?q= + fulfillment orders
 *   nuvemshop_get_order_tracking             fulfillment orders + legacy tracking fields
 *   nuvemshop_cancel_order                   POST /orders/{id}/cancel            pre-dispatch only
 *   nuvemshop_update_order_shipping_address  PATCH /orders/{id}/fulfillment-orders/{fo}  pre-dispatch only
 *   nuvemshop_add_order_note                 PUT /orders/{id} {owner_note}       appends
 *
 * No store-wide free-text order browsing on purpose: a customer-facing agent
 * must only see the orders of the customer it is talking to.
 */

const { z } = require("zod");
const { nsApi } = require("../lib/client");
const { ok, fail, toolError, READ, WRITE, DESTRUCTIVE } = require("../lib/format");
const {
  HOW_TO_REFUND,
  resolveOrder,
  getFulfillments,
  getTransactions,
  getStoreCountry,
  dispatchState,
  enrichOrder,
  PRE_DISPATCH_FO,
} = require("../lib/orders");

const ORDER_REF = {
  order_id: z
    .string()
    .optional()
    .describe("Internal Nuvemshop order id (from nuvemshop_list_customer_orders)."),
  order_number: z
    .string()
    .optional()
    .describe("The order number the customer sees (e.g. 1042 or #1042). Use when you have no id."),
};

/** Money still in play: captured, partially returned, or held on the card. */
const MONEY_IN_PLAY = new Set(["paid", "partially_paid", "partially_refunded", "authorized"]);

/** Refuse once anything has shipped: status, label or tracking recorded. */
function assertPreDispatch(order, tracking, action) {
  if (order.status === "cancelled") {
    throw toolError(
      "PRECONDITION",
      `Order #${order.number} is already cancelled; cannot ${action}.`,
    );
  }
  const { preDispatch, reason } = dispatchState(order, tracking);
  if (!preDispatch) {
    throw toolError(
      "PRECONDITION",
      `Order #${order.number} can no longer ${action}: ${reason}. It has left (or is leaving) ` +
        "the warehouse. Escalate to the merchant/carrier instead.",
    );
  }
}

/**
 * Append a timestamped line to the merchant-facing owner_note. Nuvemshop has
 * one note field (PUT replaces it), so read-modify-write keeps earlier notes.
 */
async function appendOwnerNote(order, line) {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = `[Hay.chat ${stamp} UTC] ${line}`;
  const existing = order.owner_note ? String(order.owner_note).trimEnd() : "";
  const note = existing ? `${existing}\n${entry}` : entry;
  const updated = await nsApi("PUT", `/orders/${order.id}`, { body: { owner_note: note } });
  return updated?.owner_note ?? note;
}

function registerOrderTools(server) {
  server.registerTool(
    "nuvemshop_get_order",
    {
      description:
        "Get an order by id or number with line items, totals, payment (method, Pix status, " +
        "gateway), shipping address, tracking and a supportSummary (isCancellable, " +
        "addressChangeable, isPaid, refundState, remainingRefundable, awaitingPayment, " +
        "deliveredAt, tracking: isStale/daysSinceLastUpdate/staleReason). One call answers status, payment, refund and cancellation questions.",
      inputSchema: ORDER_REF,
      annotations: READ,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const [{ rows }, transactions, originCountry] = await Promise.all([
          getFulfillments(order),
          getTransactions(order),
          getStoreCountry(),
        ]);
        return ok(enrichOrder(order, rows, transactions, { originCountry }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_get_order_tracking",
    {
      description:
        "Get an order's shipment tracking (where-is-my-order): per fulfillment, the status, " +
        "tracking number and URL, carrier, delivery window, latest carrier event and delivery " +
        "date. An empty list means nothing has been dispatched or recorded yet.",
      inputSchema: ORDER_REF,
      annotations: READ,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const { rows } = await getFulfillments(order);
        return ok({
          id: order.id,
          number: order.number,
          status: order.status,
          shippingStatus: order.shipping_status,
          tracking: rows,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_cancel_order",
    {
      description:
        "Cancel an order that has not been dispatched (WRITE): only open orders with no " +
        "tracking, shipping label or dispatched fulfillment. Restocks and emails the customer " +
        "by default. Cancelling does NOT refund: when the order is paid, partially refunded or " +
        "authorized, pass confirm_paid_cancellation=true and then call nuvemshop_request_refund.",
      inputSchema: {
        ...ORDER_REF,
        reason: z
          .enum(["customer", "inventory", "fraud", "other"])
          .describe("Cancellation reason recorded on the order."),
        restock: z.boolean().optional().describe("Return the items to stock (default true)."),
        notify_customer: z
          .boolean()
          .optional()
          .describe("Email the customer about the cancellation (default true)."),
        confirm_paid_cancellation: z
          .boolean()
          .optional()
          .describe(
            "Required (true) when the customer's money is involved: acknowledges that " +
              "cancelling does not refund or release anything.",
          ),
      },
      annotations: DESTRUCTIVE,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const { rows } = await getFulfillments(order);
        assertPreDispatch(order, rows, "be cancelled");
        if (MONEY_IN_PLAY.has(order.payment_status) && args.confirm_paid_cancellation !== true) {
          const detail =
            order.payment_status === "authorized"
              ? "has an active card authorization that cancelling will NOT release"
              : `is ${order.payment_status.replace("_", " ")}; cancelling will NOT refund it`;
          throw toolError(
            "PRECONDITION",
            `Order #${order.number} (${order.total} ${order.currency} via ` +
              `${order.gateway_name || order.gateway || "the payment provider"}) ${detail}. Tell ` +
              "the customer the money is handled separately, then retry with " +
              "confirm_paid_cancellation=true.",
          );
        }

        const cancelled = await nsApi("POST", `/orders/${order.id}/cancel`, {
          body: {
            reason: args.reason,
            email: args.notify_customer ?? true,
            restock: args.restock ?? true,
          },
        });

        let money;
        if (order.payment_status === "authorized") {
          money =
            "The card authorization was NOT released; the payment provider must void it. " +
            HOW_TO_REFUND;
        } else if (MONEY_IN_PLAY.has(order.payment_status)) {
          money =
            "No money was moved. Record the refund with nuvemshop_request_refund so the " +
            "merchant returns it through the payment provider.";
        } else if (["refunded", "voided"].includes(order.payment_status)) {
          money = `The payment was already ${order.payment_status}; nothing left to return.`;
        } else {
          money = "No payment had been captured, so nothing needs refunding.";
        }
        return ok({
          status: "CANCELLED",
          id: order.id,
          number: order.number,
          orderStatus: cancelled?.status ?? "cancelled",
          restocked: args.restock ?? true,
          moneyMoved: false,
          detail: money,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_update_order_shipping_address",
    {
      description:
        "Change where an undispatched order ships (WRITE): only open orders whose " +
        "fulfillments are still unpacked, in preparation or packed with no label or tracking. " +
        "Only the fields you pass change. Not available for store pickup.",
      inputSchema: {
        ...ORDER_REF,
        address: z
          .object({
            street: z.string().optional().describe("Street name (rua / calle)."),
            number: z.string().optional().describe("House number."),
            floor: z.string().optional().describe("Complement: floor, apartment (complemento)."),
            locality: z.string().optional().describe("Neighbourhood (bairro / barrio)."),
            city: z.string().optional(),
            zipcode: z.string().optional().describe("Postal code (CEP / código postal)."),
            reference: z.string().optional().describe("Delivery reference point."),
            between_streets: z.string().optional(),
            province_code: z.string().optional().describe('State/province code, e.g. "SP".'),
            country_code: z.string().optional().describe('ISO country code, e.g. "BR".'),
            recipient_name: z.string().optional(),
            recipient_phone: z.string().optional(),
          })
          .describe("Fields to change on the delivery address."),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const { rows, raw } = await getFulfillments(order);
        assertPreDispatch(order, rows, "have its address changed");
        const targets = raw.filter(
          (fo) => fo.id && PRE_DISPATCH_FO.has(fo.status) && fo.shipping?.type !== "pickup",
        );
        if (!targets.length) {
          throw toolError(
            "PRECONDITION",
            `Order #${order.number} has no shippable fulfillment order the API can re-address ` +
              "(store pickup, digital, or a store whose API version has no fulfillment orders). " +
              "Nuvemshop's order endpoint cannot change the address; escalate to the merchant.",
          );
        }
        const a = args.address;
        const changes = {};
        for (const key of [
          "street",
          "number",
          "floor",
          "locality",
          "city",
          "zipcode",
          "reference",
          "between_streets",
        ]) {
          if (a[key] !== undefined) changes[key] = a[key];
        }
        if (a.province_code) changes.province = { code: a.province_code };
        if (a.country_code) changes.country = { code: a.country_code };
        const recipient = {};
        if (a.recipient_name) recipient.name = a.recipient_name;
        if (a.recipient_phone) recipient.phone = a.recipient_phone;
        if (!Object.keys(changes).length && !Object.keys(recipient).length) {
          throw toolError("BAD_INPUT", "Pass at least one address field to change.");
        }

        const results = [];
        for (const fo of targets) {
          const current = fo.destination || {};
          const destination = {
            ...current,
            province: current.province?.code ? { code: current.province.code } : undefined,
            region: current.region?.code ? { code: current.region.code } : undefined,
            country: current.country?.code ? { code: current.country.code } : undefined,
            ...changes,
          };
          for (const k of Object.keys(destination)) {
            if (destination[k] === undefined) delete destination[k];
          }
          const body = Object.keys(changes).length ? { destination } : {};
          if (Object.keys(recipient).length)
            body.recipient = { ...(fo.recipient || {}), ...recipient };
          const updated = await nsApi(
            "PATCH",
            `/orders/${order.id}/fulfillment-orders/${encodeURIComponent(fo.id)}`,
            { body },
          );
          results.push({
            fulfillmentOrderId: fo.id,
            destination: updated?.destination ?? destination,
            recipient: updated?.recipient ?? body.recipient ?? fo.recipient ?? null,
          });
        }
        return ok({
          id: order.id,
          number: order.number,
          updated: results,
          detail:
            "The delivery address on the fulfillment order changed. The shipping cost was not " +
            "recalculated; if the new address is in another region, tell the merchant.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_add_order_note",
    {
      description:
        "Append a timestamped line to the order's merchant-facing note (WRITE). Earlier notes " +
        "are kept. The customer does not see it. Use it to leave an audit trail of support " +
        "actions.",
      inputSchema: {
        ...ORDER_REF,
        note: z.string().min(1).max(1000).describe("Note text."),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ownerNote = await appendOwnerNote(order, args.note);
        return ok({ id: order.id, number: order.number, ownerNote });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools, assertPreDispatch, appendOwnerNote, ORDER_REF };

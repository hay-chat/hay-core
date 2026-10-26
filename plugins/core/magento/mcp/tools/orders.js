/**
 * Order tools — rich reads, narrow bounded writes.
 *
 *   magento_get_order                      GET order + shipments + invoices
 *   magento_get_order_tracking             GET shipments (tracks)
 *   magento_cancel_order                   POST /orders/{id}/cancel      (not invoiced/shipped)
 *   magento_update_order_shipping_address  PUT /orders/{id} (address)    (not shipped)
 *   magento_add_order_note                 POST /orders/{id}/comments
 */

const { z } = require("zod");
const { magentoApi } = require("../lib/client");
const { ok, fail, num } = require("../lib/format");
const {
  resolveOrder,
  getShipments,
  getInvoices,
  enrichOrder,
  trackingSummary,
  shippingAddressOf,
  CANCELLABLE_STATES,
  CLOSED_STATES,
} = require("../lib/orders");

const ORDER_REF = {
  order_id: z.string().optional().describe("Magento order entity id."),
  order_number: z
    .string()
    .optional()
    .describe(
      "The order number the customer sees (increment id, e.g. 000000123). Use when you have no id.",
    ),
};

function registerOrderTools(server) {
  server.tool(
    "magento_get_order",
    "Get an order by id or number with line items, totals, shipping address, invoices, shipment " +
      "tracking and a supportSummary (isCancellable, isRefundable, remainingRefundable, " +
      "addressChangeable, needsCreditMemo). One call answers status, refund and cancellation questions.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const [shipments, invoices] = await Promise.all([
          getShipments(order.entity_id).catch((err) => {
            console.error(`[magento] shipments read failed: ${err.message}`);
            return null;
          }),
          getInvoices(order.entity_id).catch((err) => {
            console.error(`[magento] invoices read failed: ${err.message}`);
            return null;
          }),
        ]);
        return ok(enrichOrder(order, shipments, invoices));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_get_order_tracking",
    "Get an order's shipments and tracking numbers (where-is-my-order). An empty list means " +
      "nothing has shipped yet.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const shipments = await getShipments(order.entity_id);
        return ok({
          id: order.entity_id,
          number: order.increment_id,
          status: order.status,
          tracking: trackingSummary(shipments),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_cancel_order",
    "Cancel an order that has not been invoiced or shipped (WRITE). Magento cannot cancel a paid " +
      "order — for those, refund with magento_create_refund instead. Optionally adds a comment.",
    {
      ...ORDER_REF,
      note: z.string().optional().describe("Internal comment explaining the cancellation."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ref = `#${order.increment_id}`;
        if (order.state === "canceled") throw new Error(`Order ${ref} is already cancelled.`);
        if (CLOSED_STATES.has(order.state)) {
          throw new Error(`Order ${ref} is ${order.state}; it cannot be cancelled.`);
        }
        if (num(order.total_paid) > 0 || num(order.total_invoiced) > 0) {
          throw new Error(
            `Order ${ref} has been invoiced/paid (${order.total_paid ?? order.total_invoiced} ` +
              `${order.order_currency_code}); Magento cannot cancel it. Refund it with ` +
              "magento_create_refund instead (a credit memo closes the order).",
          );
        }
        if (order.state === "holded") {
          throw new Error(
            `Order ${ref} is on hold; Magento cannot cancel a held order. Ask the merchant to ` +
              "release it (Sales → Orders → Unhold), then cancel.",
          );
        }
        if (order.state === "payment_review") {
          throw new Error(
            `Order ${ref} is in payment review; Magento cannot cancel it until the payment ` +
              "provider settles the review. Escalate to the merchant.",
          );
        }
        if (!CANCELLABLE_STATES.has(order.state)) {
          throw new Error(
            `Order ${ref} is in state "${order.state}" and cannot be cancelled. Escalate to the merchant.`,
          );
        }
        const result = await magentoApi("POST", `/orders/${order.entity_id}/cancel`);
        if (result !== true) {
          throw new Error(
            `Magento refused to cancel order ${ref} (response: ${JSON.stringify(result)}).`,
          );
        }
        if (args.note) {
          await magentoApi("POST", `/orders/${order.entity_id}/comments`, {
            body: {
              statusHistory: {
                comment: args.note,
                is_customer_notified: 0,
                is_visible_on_front: 0,
              },
            },
          });
        }
        return ok({
          status: "CANCELLED",
          id: order.entity_id,
          number: order.increment_id,
          orderStatus: "canceled",
          detail: "The order is cancelled. Nothing was paid, so there is nothing to refund.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_update_order_shipping_address",
    "Change where an unshipped order ships (WRITE). Refuses once a shipment exists. Only the " +
      "fields you pass change; the rest of the address is kept.",
    {
      ...ORDER_REF,
      address: z
        .object({
          firstname: z.string().optional(),
          lastname: z.string().optional(),
          company: z.string().optional(),
          street: z
            .array(z.string())
            .optional()
            .describe('Street lines, e.g. ["Rua A 1", "2º Esq"].'),
          city: z.string().optional(),
          region: z.string().optional().describe('Region/state name, e.g. "California".'),
          region_code: z.string().optional().describe('Region code, e.g. "CA".'),
          region_id: z
            .number()
            .int()
            .optional()
            .describe("Magento region id (preferred when known)."),
          postcode: z.string().optional(),
          country_id: z.string().optional().describe('ISO 3166-1 alpha-2 country code, e.g. "US".'),
          telephone: z.string().optional(),
        })
        .describe("Fields to change on the shipping address."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ref = `#${order.increment_id}`;
        if (CLOSED_STATES.has(order.state)) {
          throw new Error(
            `Order ${ref} is ${order.state}; its shipping address can no longer change.`,
          );
        }
        const shipments = await getShipments(order.entity_id);
        if (shipments.length || (order.items || []).some((i) => num(i.qty_shipped) > 0)) {
          throw new Error(
            `Order ${ref} already has a shipment; the shipping address can only be changed before ` +
              "dispatch. Escalate to the merchant/carrier instead.",
          );
        }
        const current = shippingAddressOf(order);
        if (!current?.entity_id) {
          throw new Error(`Order ${ref} has no shipping address on file (virtual order?).`);
        }
        const entity = {
          ...current,
          ...args.address,
          parent_id: order.entity_id,
          address_type: "shipping",
        };
        delete entity.extension_attributes;
        const saved = await magentoApi("PUT", `/orders/${order.entity_id}`, { body: { entity } });
        return ok({
          id: order.entity_id,
          number: order.increment_id,
          shippingAddress: saved ?? entity,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "magento_add_order_note",
    "Add an internal comment to an order's history (WRITE). Set customer_note=true to also " +
      "email it to the customer and show it in their account.",
    {
      ...ORDER_REF,
      note: z.string().describe("Comment text."),
      customer_note: z
        .boolean()
        .optional()
        .describe("Notify the customer and show it in their account (default false)."),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const visible = args.customer_note ? 1 : 0;
        const result = await magentoApi("POST", `/orders/${order.entity_id}/comments`, {
          body: {
            statusHistory: {
              comment: args.note,
              is_customer_notified: visible,
              is_visible_on_front: visible,
              status: order.status,
            },
          },
        });
        return ok({
          id: order.entity_id,
          number: order.increment_id,
          added: result === true,
          note: args.note,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderTools };

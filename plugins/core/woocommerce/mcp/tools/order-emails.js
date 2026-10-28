/**
 * Order email tools.
 *
 *   woocommerce_resend_order_confirmation   POST /orders/{id}/actions/send_order_details  (WC 9.5+)
 *
 * The email always goes to the billing address already on the order:
 * `email` / `force_email_update` are never sent, so the agent cannot redirect
 * order details to an address a chat participant typed.
 */

const { wcApi, WooApiError } = require("../lib/client");
const { ok, fail, toolError } = require("../lib/format");
const { resolveOrder } = require("../lib/orders");
const { ORDER_REF } = require("./orders");

function registerOrderEmailTools(server) {
  server.tool(
    "woocommerce_resend_order_confirmation",
    "Resend the order details email (the order confirmation) to the billing email already on " +
      "the order (WRITE). Use when the customer says they never got their confirmation. It " +
      "cannot send to a different address. Needs WooCommerce 9.5 or later. Only say it was sent " +
      "if this tool returns sent: true.",
    ORDER_REF,
    async (args) => {
      try {
        const order = await resolveOrder(args);
        if (!order.billing || !order.billing.email) {
          throw toolError(
            "PRECONDITION",
            `Order #${order.number} has no billing email, so there is nowhere to send it.`,
            { details: { reason: "NO_EMAIL" } },
          );
        }
        let res;
        try {
          res = await wcApi("POST", `/orders/${order.id}/actions/send_order_details`, { body: {} });
        } catch (err) {
          // The order was just read, so a 404 here means the route itself is missing.
          if (
            err instanceof WooApiError &&
            (err.status === 404 || err.wooCode === "rest_no_route")
          ) {
            throw toolError(
              "PRECONDITION",
              "This store's WooCommerce is older than 9.5 and can't resend order emails " +
                "through Hay.chat. Hand the conversation to the store team.",
              { details: { reason: "UNSUPPORTED_WC_VERSION" } },
            );
          }
          throw err;
        }
        return ok({
          sent: true,
          id: order.id,
          number: order.number,
          sentTo: order.billing.email,
          message: res?.message ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerOrderEmailTools };

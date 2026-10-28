/**
 * Order email tools.
 *
 *   woocommerce_resend_order_confirmation   POST /orders/{id}/actions/send_order_details  (WC 9.5+)
 *
 * The email always goes to the billing address already on the order:
 * `email` / `force_email_update` are never sent, so the agent cannot redirect
 * order details to an address a chat participant typed.
 *
 * WooCommerce answers 200 even when wp_mail fails; the only trace is an order
 * note ("Email ... failed to send"). We compare notes before and after so the
 * agent never tells a shopper an email went out when it did not.
 */

const { wcApi, WooApiError } = require("../lib/client");
const { ok, fail, toolError } = require("../lib/format");
const { resolveOrder } = require("../lib/orders");
const { ORDER_REF } = require("./orders");

// en: 'Email "%s" failed to send: …'. Other locales translate it, so also match
// the pt-BR/es wording loosely.
const MAIL_FAILED = /failed to send|falh\w* ao enviar|n[aã]o (foi|p[oô]de) (possível )?(ser )?enviad|no se pudo enviar/i;

async function listNoteIds(orderId) {
  const notes = await wcApi("GET", `/orders/${orderId}/notes`, { query: { type: "any" } });
  return Array.isArray(notes) ? notes : [];
}

function registerOrderEmailTools(server) {
  server.tool(
    "woocommerce_resend_order_confirmation",
    "Resend the order details email (the order confirmation) to the billing email already on " +
      "the order (WRITE). Use when the customer says they never got their confirmation. It " +
      "cannot send to a different address. Needs WooCommerce 9.5 or later. Only say it was sent " +
      "if this tool returns sent: true; if verified is false, say the store was asked to send it.",
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
        // Best effort: if the notes can't be read we can't verify, so say so.
        let before = null;
        try {
          before = new Set((await listNoteIds(order.id)).map((n) => n.id));
        } catch (err) {
          console.error(`[woocommerce] order notes for ${order.id} failed: ${err.message}`);
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
        let verified = false;
        if (before) {
          try {
            const fresh = (await listNoteIds(order.id)).filter((n) => !before.has(n.id));
            const failure = fresh.find((n) => MAIL_FAILED.test(String(n.note ?? "")));
            if (failure) {
              throw toolError(
                "PROVIDER_REFUSED",
                `The store tried to send the order details for #${order.number} but its mail ` +
                  "server failed, so the email did NOT go out. Tell the customer it could not be " +
                  "sent and hand the conversation to the store team.",
                { details: { reason: "EMAIL_FAILED" } },
              );
            }
            verified = true;
          } catch (err) {
            if (err && err.code === "PROVIDER_REFUSED") throw err;
            console.error(`[woocommerce] order notes for ${order.id} failed: ${err.message}`);
          }
        }
        return ok({
          sent: true,
          verified,
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

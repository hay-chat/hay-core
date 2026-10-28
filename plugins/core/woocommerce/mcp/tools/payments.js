/**
 * Payment tool (D10-3) — resend the Pix code or payment link of an UNPAID order.
 *
 *   woocommerce_resend_pix   GET /orders/{id}
 *
 * Roger's D10 decision: the agent sends it automatically once the shopper's
 * email or phone matches the order. That check is enforced here, not in the
 * prompt: without a match nothing is returned. Returns the Pix copy-paste code
 * while it is valid (gateway order meta, see lib/pix.js), else WooCommerce's own
 * payment page (payment_url).
 */

const { z } = require("zod");
const { matchIdentity, hasIdentity } = require("@hay/plugin-sdk/identity");
const { ok, fail, toolError } = require("../lib/format");
const { resolveOrder } = require("../lib/orders");
const { parsePix } = require("../lib/pix");
const { ORDER_REF } = require("./orders");

const UNPAYABLE_STATUSES = new Set(["cancelled", "refunded", "trash"]);

function identityOnOrder(order) {
  return {
    emails: [order.billing?.email],
    phones: [order.billing?.phone, order.shipping?.phone],
  };
}

function isUnpaid(order) {
  return order.needs_payment === true || (!order.date_paid && order.status === "pending");
}

/**
 * Epoch ms of a Pix expiry. A store-local "Y-m-dTH:i:s" is converted with the
 * store's offset, read from the order's date_created vs date_created_gmt.
 */
function expiryMs(pix, order) {
  if (!pix.expiresAt) return null;
  if (!pix.expiresAtIsLocal) return Date.parse(pix.expiresAt);
  const local = Date.parse(`${pix.expiresAt}Z`);
  const created = Date.parse(`${order.date_created}Z`);
  const createdGmt = Date.parse(`${order.date_created_gmt}Z`);
  const offset = Number.isFinite(created) && Number.isFinite(createdGmt) ? created - createdGmt : 0;
  return local - offset;
}

function registerPaymentTools(server) {
  server.tool(
    "woocommerce_resend_pix",
    "Get the Pix copy-paste code, or the payment link, of an UNPAID order so the customer can " +
      "pay. Requires the customer's email or phone, which must match the order; nothing is " +
      "returned otherwise. Send the code or link to the customer as returned. found=false means " +
      "there is nothing valid to send (paid, cancelled or expired with no payment page): hand " +
      "off to the store team instead of inventing one.",
    {
      ...ORDER_REF,
      email: z.string().optional().describe("Email the customer gave you in this conversation."),
      phone: z.string().optional().describe("Phone the customer gave you in this conversation."),
    },
    async (args) => {
      try {
        if (!hasIdentity(args)) {
          throw toolError(
            "BAD_INPUT",
            "Ask the customer for the email or phone used on the order first; payment details " +
              "are only shared after it matches.",
          );
        }
        const order = await resolveOrder(args);
        const matchedBy = matchIdentity(identityOnOrder(order), args);
        if (!matchedBy) {
          throw toolError(
            "PRECONDITION",
            `The email/phone given does not match order #${order.number}. Do not share payment ` +
              "details; ask the customer to confirm the email used at checkout.",
            { details: { reason: "IDENTITY_MISMATCH" } },
          );
        }
        const base = { id: order.id, number: order.number, matchedBy, status: order.status };
        if (UNPAYABLE_STATUSES.has(order.status)) {
          return ok({
            ...base,
            found: false,
            message: `Order #${order.number} is ${order.status}; it can no longer be paid.`,
          });
        }
        if (!isUnpaid(order)) {
          return ok({ ...base, found: false, message: `Order #${order.number} is already paid.` });
        }

        const total = { amount: order.total, currency: order.currency };
        const pix = parsePix(order.meta_data);
        const expires = pix ? expiryMs(pix, order) : null;
        const pixValid = pix && pix.copyPaste && (expires === null || expires > Date.now());
        if (pixValid) {
          return ok({
            ...base,
            found: true,
            total,
            method: "pix",
            pixCopyPaste: pix.copyPaste,
            qrImageUrl: pix.qrImageUrl,
            expiresAt: pix.expiresAt,
            paymentUrl: order.payment_url || null,
          });
        }
        if (order.payment_url) {
          return ok({
            ...base,
            found: true,
            total,
            method: "payment_link",
            paymentUrl: order.payment_url,
            pixExpired: Boolean(pix && pix.copyPaste),
            note:
              pix && pix.copyPaste
                ? "The Pix code expired. The payment link lets the customer generate a new one."
                : undefined,
          });
        }
        return ok({
          ...base,
          found: false,
          message:
            "There is no valid Pix code or payment link for this order. Hand off to the store " +
            "team to resend it.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerPaymentTools, expiryMs };

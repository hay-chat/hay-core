/**
 * Payment tool — the Pix code / boleto / payment link for an UNPAID order.
 *
 *   nuvemshop_get_payment_link  GET /orders/{id} + GET /orders/{id}/transactions
 *
 * Roger's D10 decision: the agent may send it automatically once the
 * shopper's email or phone matches the order. That identity check is enforced
 * here, not in the prompt: without a match nothing is returned.
 *
 * Source: the order has no payment-link field (`gateway_link` is the
 * provider's transaction page for the merchant, never sent to shoppers). The
 * Transactions resource carries `info.external_resource_url` (Pix QR image /
 * boleto URL), `info.external_resource_code` and `info.external_resource_expires_at`
 * — but it is documented as "for the exclusive use of payment apps", so a
 * merchant token may be refused. When nothing usable comes back the tool says
 * so and the agent hands off.
 */

const { z } = require("zod");
const { ok, fail, toolError, sameEmail, samePhone, phoneKey, READ } = require("../lib/format");
const { resolveOrder, getTransactions, paymentInfo } = require("../lib/orders");
const { ORDER_REF } = require("./orders");

function identityMatches(order, { email, phone }) {
  const emails = [order.contact_email, order.customer?.email];
  const phones = [
    order.contact_phone,
    order.customer?.phone,
    order.billing_phone,
    order.shipping_address?.phone,
  ];
  if (email && emails.some((e) => sameEmail(e, email))) return "email";
  if (phone && phones.some((p) => samePhone(p, phone))) return "phone";
  return null;
}

const LINK_METHODS = new Set(["pix", "boleto", "ticket", "wire_transfer", "bank_transfer"]);

function pickPaymentResource(transactions, now = Date.now()) {
  const candidates = (transactions || [])
    .filter((t) => ["pending", "authorized"].includes(String(t.status || "").toLowerCase()))
    .filter((t) => t.info?.external_resource_url || t.info?.external_resource_code)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const t of candidates) {
    const expiresAt = t.info.external_resource_expires_at || null;
    const expired = expiresAt ? Date.parse(expiresAt) <= now : false;
    const method = t.payment_method?.type || null;
    if (method && !LINK_METHODS.has(method)) continue;
    return {
      method,
      url: t.info.external_resource_url || null,
      code: t.info.external_resource_code || null,
      expiresAt,
      expired,
    };
  }
  return null;
}

function registerPaymentTools(server) {
  server.registerTool(
    "nuvemshop_get_payment_link",
    {
      description:
        "Get the Pix code, boleto or payment link of an UNPAID order so the customer can pay. " +
        "Requires the customer's email or phone, which must match the order; nothing is " +
        "returned otherwise. found=false means the store does not expose one: hand off to the " +
        "merchant instead of inventing a link.",
      inputSchema: {
        ...ORDER_REF,
        email: z.string().optional().describe("Email the customer gave you in this conversation."),
        phone: z.string().optional().describe("Phone the customer gave you in this conversation."),
      },
      annotations: READ,
    },
    async (args) => {
      try {
        if (!args.email && !phoneKey(args.phone)) {
          throw toolError(
            "BAD_INPUT",
            "Ask the customer for the email or phone used on the order first; the payment " +
              "link is only shared after it matches.",
          );
        }
        const order = await resolveOrder(args);
        const matchedBy = identityMatches(order, args);
        if (!matchedBy) {
          return fail(
            toolError(
              "PRECONDITION",
              `The email/phone given does not match order #${order.number}. Do not share ` +
                "payment details; ask the customer to confirm the email used at checkout.",
            ),
          );
        }
        const payment = paymentInfo(order);
        if (order.status === "cancelled") {
          throw toolError(
            "PRECONDITION",
            `Order #${order.number} is cancelled; it can no longer be paid.`,
          );
        }
        if (!payment.awaitingPayment) {
          return ok({
            found: false,
            id: order.id,
            number: order.number,
            paymentStatus: order.payment_status,
            message:
              order.payment_status === "abandoned"
                ? "The payment window expired (abandoned). The customer has to place the order again or the merchant creates a new payment."
                : `The order is not awaiting payment (payment_status "${order.payment_status}").`,
          });
        }
        const transactions = await getTransactions(order);
        const resource = pickPaymentResource(transactions);
        if (!resource || resource.expired) {
          return ok({
            found: false,
            id: order.id,
            number: order.number,
            matchedBy,
            payment,
            expiredAt: resource?.expired ? resource.expiresAt : null,
            message:
              (resource?.expired
                ? "The payment code has expired. "
                : "The store's API does not expose a payment link or Pix code for this order. ") +
              "Hand off to the merchant to resend it from the payment provider.",
          });
        }
        return ok({
          found: true,
          id: order.id,
          number: order.number,
          matchedBy,
          total: { amount: order.total, currency: order.currency },
          paymentMethod: resource.method || payment.method,
          paymentUrl: resource.url,
          paymentCode: resource.code,
          expiresAt: resource.expiresAt,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerPaymentTools, identityMatches, pickPaymentResource };

// tools/payments.js — resend the payment link of an unpaid Shopify order (D10-3).
//
// shopify_send_payment_link emails the order invoice (orderInvoiceSend, needs
// write_orders) to the email already on the order. Roger's D10 decision: the agent
// sends it automatically once the shopper's email or phone matches the order; that
// check and the PENDING-only rule are enforced here, not in the prompt. The invoice
// email carries Shopify's checkout link, so it is the payment link, not a receipt.

const { z } = require("zod");
const { matchIdentity, hasIdentity } = require("@hay/plugin-sdk/identity");
const { shopifyGql } = require("../lib/client");
const { orderNotFound } = require("./orders");
const { ok, fail, toolError, toGid, assertNoUserErrors } = require("../lib/format");

const PAYMENT_LINK_CONTEXT = `
  query PaymentLinkContext($id: ID!) {
    order(id: $id) {
      id
      name
      email
      phone
      cancelledAt
      displayFinancialStatus
      totalOutstandingSet { shopMoney { amount currencyCode } }
      billingAddress { phone }
      shippingAddress { phone }
      customer { defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
    }
  }
`;

const SEND_INVOICE = `
  mutation SendPaymentLink($id: ID!) {
    orderInvoiceSend(id: $id) {
      order { id name }
      userErrors { field message }
    }
  }
`;

function identityOnOrder(order) {
  return {
    emails: [order.email, order.customer?.defaultEmailAddress?.emailAddress],
    phones: [
      order.phone,
      order.billingAddress?.phone,
      order.shippingAddress?.phone,
      order.customer?.defaultPhoneNumber?.phoneNumber,
    ],
  };
}

function registerPaymentTools(server) {
  server.tool(
    "shopify_send_payment_link",
    "Email the payment link (the order invoice with Shopify's checkout link) for an UNPAID " +
      "order to the email already on the order (WRITE). Only for orders with payment pending. " +
      "Requires the customer's email or phone, which must match the order; nothing is sent " +
      "otherwise. It cannot send to a different address. Only say it was sent if this tool " +
      "returns sent: true.",
    {
      order_id: z.string().describe("Order GID or bare numeric id."),
      email: z.string().optional().describe("Email the customer gave you in this conversation."),
      phone: z.string().optional().describe("Phone the customer gave you in this conversation."),
    },
    async (args) => {
      try {
        if (!hasIdentity(args)) {
          throw toolError(
            "BAD_INPUT",
            "Ask the customer for the email or phone used on the order first; the payment link " +
              "is only sent after it matches.",
          );
        }
        const id = toGid("Order", args.order_id);
        const { order } = await shopifyGql(PAYMENT_LINK_CONTEXT, { id });
        if (!order) throw await orderNotFound(args.order_id);
        const matchedBy = matchIdentity(identityOnOrder(order), args);
        if (!matchedBy) {
          throw toolError(
            "PRECONDITION",
            `The email/phone given does not match order ${order.name}. Do not send payment ` +
              "details; ask the customer to confirm the email used at checkout.",
            { details: { reason: "IDENTITY_MISMATCH" } },
          );
        }
        if (order.cancelledAt) {
          throw toolError(
            "PRECONDITION",
            `Order ${order.name} is cancelled; it can no longer be paid.`,
            {
              details: { reason: "ALREADY_CANCELLED" },
            },
          );
        }
        if (order.displayFinancialStatus !== "PENDING") {
          throw toolError(
            "PRECONDITION",
            `Order ${order.name} is not awaiting payment (${order.displayFinancialStatus}), so ` +
              "there is no payment link to send.",
            { details: { reason: "NOT_PENDING", financialStatus: order.displayFinancialStatus } },
          );
        }
        if (!order.email) {
          throw toolError(
            "PRECONDITION",
            `Order ${order.name} has no email, so the payment link can't be sent. Hand off to the ` +
              "store team.",
            { details: { reason: "NO_EMAIL" } },
          );
        }
        const data = await shopifyGql(SEND_INVOICE, { id });
        assertNoUserErrors(data.orderInvoiceSend);
        return ok({
          sent: true,
          order: data.orderInvoiceSend.order,
          sentTo: order.email,
          matchedBy,
          amountDue: order.totalOutstandingSet?.shopMoney ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerPaymentTools };

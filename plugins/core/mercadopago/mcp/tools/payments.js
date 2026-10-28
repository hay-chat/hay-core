/**
 * The payment_provider contract tools for Mercado Pago
 * (@hay/plugin-sdk/payment-provider, README.md there).
 *
 *   mercadopago_get_payment     GET  /v1/payments/{id}
 *   mercadopago_find_payments   GET  /v1/payments/{id}, /v1/payments/search?external_reference=
 *   mercadopago_resend_payment  GET  /v1/payments/{id}   (identity-gated Pix code / link)
 *   mercadopago_refund          POST /v1/payments/{id}/refunds   (bounded, idempotent)
 *   mercadopago_refund_status   GET  /v1/payments/{id}
 *
 * Refunds send X-Idempotency-Key and X-Render-In-Process-Refunds: true, so a Pix
 * refund the bank has not confirmed comes back as 201 + status in_process
 * instead of a 400.
 * @see https://www.mercadopago.com.br/developers/en/docs/checkout-api/payment-management/cancellations-and-refunds/refund-pix
 */

const { z } = require("zod");
const { toolError, toolErrorResult } = require("@hay/plugin-sdk/tool-errors");
const { matchIdentity, hasIdentity } = require("@hay/plugin-sdk/identity");
const {
  toCents,
  fromCents,
  refundBound,
  refundIdempotencyKey,
  findDuplicateRefund,
} = require("@hay/plugin-sdk/payment-provider");
const { mpApi, MercadoPagoApiError } = require("../lib/client");
const {
  PROVIDER,
  normalizePayment,
  normalizeRefund,
  refundedCents,
  payerIdentity,
  paymentInstructions,
  candidateReferences,
} = require("../lib/payments");

const MAX_LOOKUPS = 10;

const ok = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });

const PAYMENT_ID = z
  .string()
  .regex(/^\d+$/, "A Mercado Pago payment id is numeric")
  .describe(
    "Mercado Pago payment id (numeric). Get it from mercadopago_find_payments, or from the " +
      "order: WooCommerce paymentReferences, Shopify transactions[].paymentId.",
  );

async function getPayment(paymentId) {
  return mpApi("GET", `/v1/payments/${encodeURIComponent(paymentId)}`);
}

/** Agent-facing note for one refund, by status and method. Never states a legal deadline. */
function refundNote(refund, method) {
  if (refund.status === "pending") {
    return (
      "Mercado Pago sent the refund and is waiting for the bank to confirm it. Tell the " +
      "customer it is being processed; do not say the money has arrived."
    );
  }
  if (refund.status === "failed") {
    return "Mercado Pago did not complete this refund. Hand off to the store team.";
  }
  if (method === "card") {
    return (
      `Mercado Pago completed the card refund on ${refund.createdAt || "the date shown"}. When ` +
      "it shows on the statement depends on the customer's card issuer: do not promise a date."
    );
  }
  return "Mercado Pago completed the refund to the payer's account.";
}

function registerPaymentTools(server) {
  server.registerTool(
    "mercadopago_get_payment",
    {
      description:
        "Get one Mercado Pago payment: status (pending, paid, refunded, in_dispute…), method " +
        "(pix, card, boleto), amount, refunded and refundable amounts, dates and refunds. " +
        "Does not return the Pix code: use mercadopago_resend_payment for that.",
      inputSchema: { payment_id: PAYMENT_ID },
    },
    async ({ payment_id }) => {
      try {
        return ok(normalizePayment(await getPayment(payment_id)));
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "mercadopago_find_payments",
    {
      description:
        "Find the Mercado Pago payments behind a store order. Pass what the order tool returned: " +
        "WooCommerce paymentReferences[].paymentId and transactionId, or the paymentId of " +
        "Shopify transactions whose gateway is Mercado Pago, plus the order id. found=false " +
        "means Mercado Pago has no payment for it (another provider took the money, or the " +
        "order was never paid there).",
      inputSchema: {
        payment_ids: z
          .array(z.string())
          .max(MAX_LOOKUPS)
          .optional()
          .describe("Payment ids or references from the order tool."),
        order_id: z
          .string()
          .optional()
          .describe("Store order id or number (searched as the order reference)."),
        source: z
          .enum(["woocommerce", "shopify", "other"])
          .optional()
          .describe("Which store the order comes from."),
      },
    },
    async ({ payment_ids, order_id, source }) => {
      try {
        const { ids, externalReferences } = candidateReferences({
          paymentIds: payment_ids,
          orderId: order_id,
          source,
        });
        if (!ids.length && !externalReferences.length) {
          throw toolError("BAD_INPUT", "Pass payment_ids or order_id from the order.");
        }
        const found = new Map();
        for (const id of ids.slice(0, MAX_LOOKUPS)) {
          try {
            const p = await getPayment(id);
            found.set(String(p.id), p);
          } catch (err) {
            // Not every id on an order is a Mercado Pago payment id.
            if (!(err instanceof MercadoPagoApiError && [400, 404].includes(err.status))) throw err;
          }
        }
        for (const ref of externalReferences.slice(0, MAX_LOOKUPS)) {
          const res = await mpApi("GET", "/v1/payments/search", {
            query: { external_reference: ref, sort: "date_created", criteria: "desc", limit: 10 },
          });
          for (const p of res?.results || []) found.set(String(p.id), p);
        }
        const payments = [...found.values()]
          .map(normalizePayment)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return ok({ found: payments.length > 0, payments });
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "mercadopago_resend_payment",
    {
      description:
        "Get the Pix copy-paste code (or payment link) of an UNPAID Mercado Pago payment so the " +
        "customer can pay. Requires the email or phone the customer gave you, which must match " +
        "the payer on the payment; nothing is returned otherwise. Send the code or link as " +
        "returned. found=false means there is nothing valid to send (paid, cancelled or " +
        "expired): send the store's payment link with its own tool, or hand off.",
      inputSchema: {
        payment_id: PAYMENT_ID,
        email: z.string().optional().describe("Email the customer gave you in this conversation."),
        phone: z.string().optional().describe("Phone the customer gave you in this conversation."),
      },
    },
    async (args) => {
      try {
        if (!hasIdentity(args)) {
          throw toolError(
            "BAD_INPUT",
            "Ask the customer for the email or phone used to pay first; payment details are only " +
              "shared after it matches.",
          );
        }
        const payment = await getPayment(args.payment_id);
        const onPayment = payerIdentity(payment);
        if (!onPayment.emails.length && !onPayment.phones.length) {
          throw toolError(
            "PRECONDITION",
            "Mercado Pago has no payer email or phone on this payment, so the code cannot be " +
              "shared from here. Use the store's own resend tool (it checks the order) or hand off.",
            { details: { reason: "NO_PAYER_IDENTITY" } },
          );
        }
        const matchedBy = matchIdentity(onPayment, args);
        if (!matchedBy) {
          throw toolError(
            "PRECONDITION",
            "The email/phone given does not match the payer of this payment. Do not share " +
              "payment details; ask the customer to confirm the email used to pay.",
            { details: { reason: "IDENTITY_MISMATCH" } },
          );
        }
        const p = normalizePayment(payment);
        const base = {
          paymentId: p.paymentId,
          matchedBy,
          status: p.status,
          amount: p.amount,
          currency: p.currency,
        };
        if (payment.status !== "pending") {
          return ok({
            ...base,
            found: false,
            message:
              p.status === "paid" || p.status === "partially_refunded"
                ? "This payment is already paid."
                : `This payment is ${p.status}; it can no longer be paid.`,
          });
        }
        const expires = Date.parse(payment.date_of_expiration || "");
        if (Number.isFinite(expires) && expires <= Date.now()) {
          return ok({
            ...base,
            found: false,
            expiresAt: payment.date_of_expiration,
            message:
              "The Pix code expired. Send the store's payment link with its own tool (it lets " +
              "the customer generate a new code), or hand off.",
          });
        }
        const { pixCopyPaste, paymentUrl } = paymentInstructions(payment);
        if (!pixCopyPaste && !paymentUrl) {
          return ok({
            ...base,
            found: false,
            message: "Mercado Pago returned no code or link for this payment. Hand off.",
          });
        }
        return ok({
          ...base,
          found: true,
          method: p.method,
          pixCopyPaste,
          paymentUrl,
          expiresAt: payment.date_of_expiration || null,
        });
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "mercadopago_refund",
    {
      description:
        "Refund a paid Mercado Pago payment, in full (no amount) or in part. Never more than " +
        "what is still refundable; a repeated call does not refund twice. A Pix refund often " +
        "comes back status=pending: tell the customer it is being processed, not that the money " +
        "arrived. On an OUTCOME_UNKNOWN error, call mercadopago_refund_status before retrying.",
      inputSchema: {
        payment_id: PAYMENT_ID,
        amount: z
          .number()
          .positive()
          .optional()
          .describe(
            "Amount to refund in the payment currency. Omit for the full remaining amount.",
          ),
      },
    },
    async ({ payment_id, amount }) => {
      try {
        const payment = await getPayment(payment_id);
        const p = normalizePayment(payment);
        if (p.status === "in_dispute") {
          throw toolError(
            "PRECONDITION",
            "This payment has an open dispute or chargeback; it cannot be refunded here. Hand off.",
            { details: { reason: "DISPUTE_OPEN" } },
          );
        }
        if (p.status === "refunded") {
          throw toolError("PRECONDITION", "This payment has already been fully refunded.", {
            details: { reason: "ALREADY_REFUNDED" },
          });
        }
        if (payment.status !== "approved") {
          throw toolError(
            "PRECONDITION",
            `This payment is ${p.status}, so there is no money to refund. Hand off if the ` +
              "customer was charged.",
            { details: { reason: "NOT_PAID", providerStatus: payment.status } },
          );
        }
        const requestedCents = amount === undefined ? null : toCents(amount);
        if (amount !== undefined && requestedCents === null) {
          throw toolError("BAD_INPUT", "The refund amount must be a number.");
        }
        const paidCents = toCents(payment.transaction_amount) || 0;
        const refundedBefore = refundedCents(payment);
        const bound = refundBound({ paidCents, refundedCents: refundedBefore, requestedCents });

        const duplicate = findDuplicateRefund(
          p.refunds.map((r) => ({ ...r, amountCents: toCents(r.amount) })),
          bound.amountCents,
        );
        if (duplicate) {
          return ok({
            paymentId: p.paymentId,
            alreadyRequested: true,
            refund: duplicate,
            note:
              "A refund of this amount was already requested minutes ago; no second refund was " +
              `made. ${refundNote(duplicate, p.method)}`,
          });
        }

        const idempotencyKey = refundIdempotencyKey({
          provider: PROVIDER,
          paymentId: p.paymentId,
          amountCents: bound.amountCents,
          refundedCentsBefore: refundedBefore,
        });
        // Empty body = full refund (only valid while nothing was refunded before).
        const body = bound.full ? undefined : { amount: fromCents(bound.amountCents) };
        const created = await mpApi(
          "POST",
          `/v1/payments/${encodeURIComponent(payment_id)}/refunds`,
          {
            body,
            headers: { "X-Idempotency-Key": idempotencyKey, "X-Render-In-Process-Refunds": "true" },
          },
        );
        const refund = normalizeRefund(created || {});
        return ok({
          paymentId: p.paymentId,
          method: p.method,
          refund,
          currency: p.currency,
          refundableAfter: fromCents(bound.remainingCents - bound.amountCents),
          note: refundNote(refund, p.method),
        });
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );

  server.registerTool(
    "mercadopago_refund_status",
    {
      description:
        "Check the refunds of a Mercado Pago payment: each refund's status (pending, succeeded, " +
        "failed), amount and date, with a note on what to tell the customer. pending means the " +
        "bank has not confirmed it yet.",
      inputSchema: {
        payment_id: PAYMENT_ID,
        refund_id: z.string().optional().describe("One refund id, to check only that refund."),
      },
    },
    async ({ payment_id, refund_id }) => {
      try {
        const p = normalizePayment(await getPayment(payment_id));
        let refunds = p.refunds;
        if (refund_id) {
          refunds = refunds.filter((r) => r.refundId === String(refund_id));
          if (!refunds.length) {
            throw toolError("NOT_FOUND", `Refund ${refund_id} is not on payment ${payment_id}.`);
          }
        }
        return ok({
          paymentId: p.paymentId,
          paymentStatus: p.status,
          method: p.method,
          currency: p.currency,
          refundedAmount: p.refundedAmount,
          refunds: refunds.map((r) => ({ ...r, note: refundNote(r, p.method) })),
          message: refunds.length ? undefined : "This payment has no refunds.",
        });
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );
}

module.exports = { registerPaymentTools, refundNote };

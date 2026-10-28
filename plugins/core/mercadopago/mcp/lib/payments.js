/**
 * Mercado Pago payment → payment_provider contract shapes, plus the mapping
 * from store order references to Mercado Pago payments.
 *
 * Contract: @hay/plugin-sdk/payment-provider (README.md there).
 */

const { toCents, fromCents } = require("@hay/plugin-sdk/payment-provider");

const PROVIDER = "mercadopago";

/** MP payment status → contract PAYMENT_STATUSES (before the refund adjustment). */
const PAYMENT_STATUS = {
  pending: "pending",
  in_process: "pending",
  authorized: "authorized",
  approved: "paid",
  refunded: "refunded",
  cancelled: "cancelled",
  rejected: "failed",
  in_mediation: "in_dispute",
  charged_back: "in_dispute",
};

/** MP refund status → contract REFUND_STATUSES. */
const REFUND_STATUS = {
  approved: "succeeded",
  in_process: "pending",
  authorized: "pending",
  pending: "pending",
  rejected: "failed",
  cancelled: "failed",
};

function methodOf(payment) {
  const id = String(payment.payment_method_id || "").toLowerCase();
  const type = String(payment.payment_type_id || "").toLowerCase();
  if (id === "pix") return "pix";
  if (["credit_card", "debit_card", "prepaid_card"].includes(type)) return "card";
  if (type === "ticket") return "boleto";
  return "other";
}

function normalizeRefund(r) {
  return {
    refundId: r.id !== undefined && r.id !== null ? String(r.id) : null,
    status: REFUND_STATUS[String(r.status || "").toLowerCase()] || "pending",
    providerStatus: r.status || null,
    amount: Number(r.amount) || 0,
    createdAt: r.date_created || null,
  };
}

/** Cents already refunded or being refunded: the larger of MP's total and the live refunds. */
function refundedCents(payment) {
  const reported = toCents(payment.transaction_amount_refunded) || 0;
  const live = (payment.refunds || [])
    .filter((r) => (REFUND_STATUS[String(r.status || "").toLowerCase()] || "pending") !== "failed")
    .reduce((sum, r) => sum + (toCents(r.amount) || 0), 0);
  return Math.max(reported, live);
}

/** A Mercado Pago payment in the contract's normalised shape (never carries the Pix code). */
function normalizePayment(payment) {
  const paidCents = toCents(payment.transaction_amount) || 0;
  const refunded = refundedCents(payment);
  let status = PAYMENT_STATUS[String(payment.status || "").toLowerCase()] || "pending";
  if (status === "paid" && refunded > 0) {
    status = refunded >= paidCents ? "refunded" : "partially_refunded";
  }
  const refundable = status === "paid" || status === "partially_refunded";
  return {
    provider: PROVIDER,
    paymentId: String(payment.id),
    orderReference: payment.external_reference || null,
    status,
    providerStatus: payment.status || null,
    providerStatusDetail: payment.status_detail || null,
    method: methodOf(payment),
    amount: fromCents(paidCents),
    currency: payment.currency_id || null,
    refundedAmount: fromCents(refunded),
    refundableAmount: refundable ? fromCents(Math.max(0, paidCents - refunded)) : 0,
    createdAt: payment.date_created || null,
    paidAt: payment.date_approved || null,
    expiresAt: payment.date_of_expiration || null,
    refunds: (payment.refunds || []).map(normalizeRefund),
  };
}

/** Emails and phones Mercado Pago holds for the payer (for the identity gate). */
function payerIdentity(payment) {
  const phone = (p) =>
    p && (p.number || p.area_code) ? `${p.area_code || ""}${p.number || ""}` : null;
  return {
    emails: [payment.payer?.email, payment.additional_info?.payer?.email].filter(Boolean),
    phones: [phone(payment.payer?.phone), phone(payment.additional_info?.payer?.phone)].filter(
      Boolean,
    ),
  };
}

/**
 * What can be sent to the shopper to pay: the Pix copy-paste code (+ MP's
 * hosted QR page) or the boleto/ticket link.
 */
function paymentInstructions(payment) {
  const tx = payment.point_of_interaction?.transaction_data || {};
  const pixCopyPaste =
    typeof tx.qr_code === "string" && tx.qr_code.trim() ? tx.qr_code.trim() : null;
  const link = tx.ticket_url || payment.transaction_details?.external_resource_url || null;
  return {
    pixCopyPaste,
    paymentUrl: typeof link === "string" && /^https:\/\//i.test(link) ? link : null,
  };
}

/**
 * Turn store order references into lookups.
 *
 * - `paymentIds`: anything an order tool exposed. WooCommerce
 *   `paymentReferences[].paymentId` (meta `_Mercado_Pago_Payment_IDs`, may be
 *   "123, 456") and `transactionId`; Shopify `transactions[].paymentId` of a
 *   Mercado Pago transaction. Numeric parts are fetched directly; anything else
 *   is searched as `external_reference`.
 * - `orderId`: the store order id/number. The official WooCommerce plugin sends
 *   `external_reference` = store prefix (default "WC-") + order id, so both
 *   forms are searched.
 *
 * @returns {{ ids: string[], externalReferences: string[] }}
 */
function candidateReferences({ paymentIds = [], orderId, source } = {}) {
  const ids = new Set();
  const refs = new Set();
  for (const raw of paymentIds) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const parts = value.split(/[\s,;|]+/).filter(Boolean);
    if (parts.length && parts.every((p) => /^\d{6,}$/.test(p))) parts.forEach((p) => ids.add(p));
    else refs.add(value);
  }
  const order = String(orderId ?? "")
    .trim()
    .replace(/^#/, "");
  if (order) {
    refs.add(order);
    if (source !== "shopify" && !/^WC-/i.test(order)) refs.add(`WC-${order}`);
  }
  return { ids: [...ids], externalReferences: [...refs] };
}

module.exports = {
  PROVIDER,
  normalizePayment,
  normalizeRefund,
  refundedCents,
  payerIdentity,
  paymentInstructions,
  candidateReferences,
};

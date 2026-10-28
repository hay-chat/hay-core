/**
 * Shared `payment_provider` tool contract (D10-8).
 *
 * A payment provider plugin (Mercado Pago, later PagBank, Pagar.me, Asaas…)
 * registers the same five tools under its own prefix, returns the same shapes
 * and enforces the same money rules, so playbooks and the agent can treat
 * every provider alike. Core never knows which providers exist: it only sees
 * MCP tools with risk classes (see ../tool-risk).
 *
 *   <prefix>_get_payment     read    one payment, normalised (no Pix code)
 *   <prefix>_find_payments   read    payments behind a store order
 *   <prefix>_resend_payment  read    Pix copy-paste code / payment link of an
 *                                    UNPAID payment, only after the shopper's
 *                                    email or phone matches the payer
 *   <prefix>_refund          refund  bounded by what was paid, idempotent
 *   <prefix>_refund_status   read    refunds with status, including pending
 *
 * Full write-up: ./README.md.
 *
 * Plain CommonJS with no dependencies besides node:crypto, like ../tool-errors:
 * local MCP servers are CommonJS scripts spawned with `node`.
 */

const crypto = require("node:crypto");
const { toolError } = require("../tool-errors/index.cjs");

/** Contract actions and the risk class each one must carry. */
const PAYMENT_PROVIDER_ACTIONS = Object.freeze({
  get_payment: "read",
  find_payments: "read",
  // Returns data to send to the shopper; moves no money and changes nothing.
  resend_payment: "read",
  refund: "refund",
  refund_status: "read",
});

/**
 * Normalised payment status.
 * - pending: created, money not received (Pix waiting for transfer, boleto open)
 * - authorized: card authorised, not captured
 * - paid: money received, nothing refunded
 * - partially_refunded / refunded: some / all of it returned (or being returned)
 * - cancelled: never paid and closed (expired Pix, cancelled boleto)
 * - failed: rejected by the provider or the bank
 * - in_dispute: chargeback or mediation open; refunds go through the dispute
 */
const PAYMENT_STATUSES = Object.freeze([
  "pending",
  "authorized",
  "paid",
  "partially_refunded",
  "refunded",
  "cancelled",
  "failed",
  "in_dispute",
]);

/**
 * Normalised refund status. `pending` is the honest answer for a Pix refund the
 * bank has not confirmed yet (Mercado Pago `in_process`, Pagar.me
 * `pending_refund`, Asaas `PENDING`): never tell the shopper it has arrived.
 */
const REFUND_STATUSES = Object.freeze(["pending", "succeeded", "failed"]);

const PAYMENT_METHODS = Object.freeze(["pix", "card", "boleto", "other"]);

/** Tool names for one provider prefix, e.g. "mercadopago" → mercadopago_get_payment. */
function contractToolNames(prefix) {
  if (!/^[a-z][a-z0-9]*$/.test(String(prefix))) {
    throw new Error(`Invalid payment provider prefix "${prefix}" (lowercase letters/digits)`);
  }
  const names = {};
  for (const action of Object.keys(PAYMENT_PROVIDER_ACTIONS)) names[action] = `${prefix}_${action}`;
  return Object.freeze(names);
}

/**
 * The contract's tool-risk spec for a prefix (see ../tool-risk). A plugin
 * spreads it into its own spec so the refund tool is always a held `refund`.
 */
function contractToolRisk(prefix) {
  const names = contractToolNames(prefix);
  const read = [];
  const write = {};
  for (const [action, risk] of Object.entries(PAYMENT_PROVIDER_ACTIONS)) {
    if (risk === "read") read.push(names[action]);
    else write[names[action]] = risk;
  }
  return { read, write };
}

/** Decimal amount → integer cents. null for anything that is not a finite number ≥ 0. */
function toCents(amount) {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const fromCents = (cents) => Math.round(cents) / 100;

/**
 * Decide how much a refund may move. Throws the shared ToolError vocabulary.
 *
 * @param {{ paidCents: number, refundedCents: number, requestedCents?: number | null }} input
 *   refundedCents counts refunds already done AND still pending.
 * @returns {{ amountCents: number, remainingCents: number, full: boolean }}
 *   full = this refund returns the whole payment (nothing refunded before).
 */
function refundBound({ paidCents, refundedCents, requestedCents }) {
  if (!Number.isInteger(paidCents) || paidCents <= 0) {
    throw toolError("PRECONDITION", "This payment has no paid amount to refund.", {
      details: { reason: "NOTHING_PAID" },
    });
  }
  const remainingCents = Math.max(0, paidCents - Math.max(0, refundedCents || 0));
  if (remainingCents === 0) {
    throw toolError("PRECONDITION", "This payment has already been fully refunded.", {
      details: { reason: "ALREADY_REFUNDED", paid: fromCents(paidCents) },
    });
  }
  if (requestedCents === null || requestedCents === undefined) {
    return { amountCents: remainingCents, remainingCents, full: remainingCents === paidCents };
  }
  if (!Number.isInteger(requestedCents) || requestedCents <= 0) {
    throw toolError("BAD_INPUT", "The refund amount must be greater than zero.");
  }
  if (requestedCents > remainingCents) {
    throw toolError(
      "PRECONDITION",
      `The refund (${fromCents(requestedCents)}) is more than what can still be refunded ` +
        `(${fromCents(remainingCents)}).`,
      {
        details: {
          reason: "EXCEEDS_REFUNDABLE",
          requested: fromCents(requestedCents),
          refundable: fromCents(remainingCents),
        },
      },
    );
  }
  return { amountCents: requestedCents, remainingCents, full: requestedCents === paidCents };
}

/**
 * Deterministic idempotency key for one refund attempt. The same request
 * against the same payment state always yields the same key, so a retried or
 * doubled call is collapsed by the provider. Once a refund lands, the
 * refunded total changes and a later, deliberate refund gets a new key.
 */
function refundIdempotencyKey({ provider, paymentId, amountCents, refundedCentsBefore }) {
  const raw = [provider, paymentId, amountCents, refundedCentsBefore || 0].join(":");
  return `hay-${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

/**
 * The refund already on the payment that looks like this same request (same
 * amount, created within `windowMs`, not failed), or null. Providers keep
 * idempotency keys for a limited time and the key above changes once the
 * first refund is recorded, so this catches a retry after an unclear outcome.
 *
 * @param {Array<{ amountCents: number, status: string, createdAt: string | null }>} refunds
 */
function findDuplicateRefund(refunds, amountCents, { now = Date.now(), windowMs = 10 * 60 * 1000 } = {}) {
  return (
    (refunds || []).find((r) => {
      if (r.status === "failed" || r.amountCents !== amountCents) return false;
      const created = Date.parse(r.createdAt || "");
      return Number.isFinite(created) && now - created <= windowMs;
    }) || null
  );
}

/** Contract shape check for a normalised payment (used by provider plugin tests). */
function assertPaymentShape(p) {
  const problems = [];
  if (!p || typeof p !== "object") return ["not an object"];
  for (const key of ["provider", "paymentId", "status", "method", "amount", "refundedAmount", "refundableAmount", "currency"]) {
    if (!(key in p)) problems.push(`missing ${key}`);
  }
  if (!PAYMENT_STATUSES.includes(p.status)) problems.push(`bad status ${p.status}`);
  if (!PAYMENT_METHODS.includes(p.method)) problems.push(`bad method ${p.method}`);
  for (const r of p.refunds || []) {
    if (!REFUND_STATUSES.includes(r.status)) problems.push(`bad refund status ${r.status}`);
  }
  if ("pixCopyPaste" in p || "copyPaste" in p) problems.push("payment must not carry a Pix code");
  return problems;
}

module.exports = {
  PAYMENT_PROVIDER_ACTIONS,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  PAYMENT_METHODS,
  contractToolNames,
  contractToolRisk,
  toCents,
  fromCents,
  refundBound,
  refundIdempotencyKey,
  findDuplicateRefund,
  assertPaymentShape,
};

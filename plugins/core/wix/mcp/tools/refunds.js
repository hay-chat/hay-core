/**
 * Refund tool — one semantic action over three Wix endpoints:
 *
 *   GET  /ecom/v1/orders/{id}/transactions                 which payments exist + what is left
 *   POST /ecom/v1/order-billing/get-order-refundability    can the provider refund via API?
 *   POST /ecom/v1/order-billing/refund-payments            the refund itself
 *
 * Bounded server-side: never more than the order's remaining refundable
 * balance, never against a payment the provider cannot refund (unless the
 * merchant explicitly records an external refund), never silently "record
 * only" — the fallback is spelled out in the result.
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail, money, round2 } = require("../lib/format");
const { resolveOrder, getTransactions, paymentBalances } = require("../lib/orders");

const REFUNDABLE = "REFUNDABLE";
const MANUALLY_REFUNDABLE = "MANUALLY_REFUNDABLE";
const NON_REFUNDABLE = "NON_REFUNDABLE";

function normalizeState(raw) {
  const s = String(raw).toUpperCase();
  if (s.includes("MANUAL")) return MANUALLY_REFUNDABLE;
  if (s.includes("NON") || s.includes("NOT_REFUND")) return NON_REFUNDABLE;
  if (s.includes("REFUND")) return REFUNDABLE;
  return s;
}

/**
 * Tolerantly read Wix's refundability assessment into
 * `{ [transactionId]: { state, reason } }`. Wix has shipped slightly different
 * shapes for this payload, so we look for any object carrying a transaction
 * id plus a refundability-like string. `null` when nothing parseable.
 */
function parseRefundabilities(res) {
  if (!res || typeof res !== "object") return null;
  const map = {};
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const txId = node.transactionId || node.paymentId;
    const rawState =
      node.refundability ??
      node.refundabilityStatus ??
      node.status ??
      node.state ??
      (typeof node.refundable === "boolean"
        ? node.refundable
          ? REFUNDABLE
          : NON_REFUNDABLE
        : undefined);
    const stateStr = typeof rawState === "object" ? rawState?.status : rawState;
    if (txId && typeof stateStr === "string") {
      map[txId] = {
        state: normalizeState(stateStr),
        reason: node.nonRefundableReason || node.reason || rawState?.reason || null,
      };
    }
    Object.values(node).forEach(visit);
  };
  visit(res);
  return Object.keys(map).length ? map : null;
}

/**
 * Allocate `amount` across refundable payments (largest remaining first);
 * `null` amount means everything that is left. Returns `[{ paymentId, amount }]`.
 */
function allocateRefund(payments, amount) {
  const candidates = payments
    .filter((p) => p.remaining > 0 && !p.refundDisabled)
    .sort((a, b) => b.remaining - a.remaining);
  if (amount === null) {
    return candidates.map((p) => ({ paymentId: p.paymentId, amount: p.remaining }));
  }
  const plan = [];
  let left = round2(amount);
  for (const p of candidates) {
    if (left <= 0) break;
    const take = round2(Math.min(p.remaining, left));
    plan.push({ paymentId: p.paymentId, amount: take });
    left = round2(left - take);
  }
  return plan;
}

function registerRefundTools(server) {
  server.tool(
    "wix_create_refund",
    "Refund an order (WRITE): full refund when `amount` is omitted, partial otherwise. Picks the " +
      "right payment transactions itself and refuses amounts above the remaining refundable " +
      "balance. If the payment provider cannot be refunded through Wix, nothing is sent and the " +
      "result says so (refunded=false) — refund the buyer in the provider, then re-run with " +
      "external_refund=true to record it on the order.",
    {
      order_id: z.string().optional().describe("Wix order id."),
      order_number: z.string().optional().describe("The order number the buyer sees."),
      amount: z
        .string()
        .optional()
        .describe(
          'Partial amount in major units as a decimal string (e.g. "10.50"). Omit for full.',
        ),
      reason: z.string().optional().describe("Why the refund is issued (stored on the refund)."),
      restock: z.boolean().optional().describe("Restock the refunded items (default false)."),
      notify_customer: z
        .boolean()
        .optional()
        .describe("Send Wix's order-refunded email to the buyer (default false)."),
      external_refund: z
        .boolean()
        .optional()
        .describe(
          "Set true ONLY when the buyer has already been refunded outside Wix; records the refund " +
            "without calling the payment provider.",
        ),
    },
    async (args) => {
      try {
        const order = await resolveOrder(args);
        const ref = order.number ? `#${order.number}` : order.id;
        const transactions = await getTransactions(order.id);
        const payments = paymentBalances(transactions);
        const remaining = round2(payments.reduce((s, p) => s + p.remaining, 0));

        if (remaining <= 0) {
          throw new Error(
            `Order ${ref} has nothing left to refund (paid ${payments
              .reduce((s, p) => s + p.paid, 0)
              .toFixed(2)}, already refunded in full or never paid).`,
          );
        }

        let amount = null;
        if (args.amount !== undefined) {
          amount = Number(args.amount);
          if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(`Invalid refund amount "${args.amount}".`);
          }
          if (amount > remaining + 0.001) {
            throw new Error(
              `Refund of ${amount.toFixed(2)} exceeds the remaining refundable balance of ` +
                `${remaining.toFixed(2)} ${order.currency || ""} for order ${ref}.`,
            );
          }
        }

        const plan = allocateRefund(payments, amount);
        if (!plan.length) {
          throw new Error(
            `Order ${ref} has no payment that can be refunded (payments are disabled for refunds).`,
          );
        }

        if (!args.external_refund) {
          let refundability = null;
          try {
            const check = await wixApi("POST", "/ecom/v1/order-billing/get-order-refundability", {
              body: { orderId: order.id },
            });
            refundability = parseRefundabilities(check);
          } catch (checkErr) {
            // Best effort: let the refund call produce the authoritative error.
            console.error(`[wix] refundability check failed, proceeding: ${checkErr.message}`);
          }
          if (refundability) {
            const blocked = plan
              .map((p) => ({ ...p, ...(refundability[p.paymentId] || {}) }))
              .filter((p) => p.state && p.state !== REFUNDABLE);
            if (blocked.length) {
              const manual = blocked.filter((p) => p.state === MANUALLY_REFUNDABLE);
              const none = blocked.filter((p) => p.state === NON_REFUNDABLE);
              const lines = [];
              if (manual.length) {
                lines.push(
                  "This order's payment provider does not support refunds through Wix. Refund the " +
                    "buyer in the provider's dashboard, then call wix_create_refund again with " +
                    "external_refund=true to record it on the order.",
                );
              }
              if (none.length) {
                lines.push(
                  `Payment(s) ${none
                    .map((p) => (p.reason ? `${p.paymentId} (${p.reason})` : p.paymentId))
                    .join(", ")} cannot be refunded.`,
                );
              }
              return ok({
                refunded: false,
                reason: "provider_not_api_refundable",
                orderId: order.id,
                number: order.number,
                blocked,
                message: lines.join(" "),
              });
            }
          }
        }

        const body = {
          orderId: order.id,
          paymentRefunds: plan.map((p) => ({
            transactionId: p.paymentId,
            amount: money(p.amount.toFixed(2)),
            ...(args.external_refund ? { externalRefund: true } : {}),
          })),
          sideEffects: {
            restockAllItems: Boolean(args.restock),
            sendOrderRefundedEmail: Boolean(args.notify_customer),
          },
        };
        if (args.reason) body.reason = args.reason;

        const res = await wixApi("POST", "/ecom/v1/order-billing/refund-payments", { body });
        const refundedTotal = round2(plan.reduce((s, p) => s + p.amount, 0));
        return ok({
          refunded: true,
          external: Boolean(args.external_refund),
          orderId: order.id,
          number: order.number,
          amount: { amount: refundedTotal.toFixed(2), currency: order.currency ?? null },
          remainingRefundable: {
            amount: round2(remaining - refundedTotal).toFixed(2),
            currency: order.currency ?? null,
          },
          payments: plan,
          result: res,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerRefundTools, parseRefundabilities, allocateRefund };

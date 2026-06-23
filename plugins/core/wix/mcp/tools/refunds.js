/**
 * Refund tools — the Wix eCommerce Order Billing API (`/ecom/v1/order-billing`).
 *
 * Implements the refund half of the HAY-240 acceptance criteria:
 *   - Full or partial refunds where the payment provider supports API refunds.
 *   - A clear, non-silent fallback when it does NOT: the merchant refunds the
 *     customer manually and we record it as an *external* refund so the order's
 *     transaction records stay accurate.
 *
 * The agent should normally call get_order_transactions (for transaction IDs)
 * and may call get_order_refundability first; refund_order also self-checks
 * refundability so it never fires a doomed provider call.
 */

const { z } = require("zod");
const { wixApi } = require("../lib/client");
const { ok, fail, money } = require("../lib/format");

const REFUNDABLE = "REFUNDABLE";
const MANUALLY_REFUNDABLE = "MANUALLY_REFUNDABLE";
const NON_REFUNDABLE = "NON_REFUNDABLE";

/**
 * Tolerantly read Wix's refundability assessment into
 * `{ [transactionId]: { state, reason } }`. Wix has shipped slightly different
 * shapes for this payload, so we look for any array of objects that carry a
 * transaction id plus a refundability-like string and normalise the state.
 * If nothing parseable is found we return `null` → callers should not block.
 */
function parseRefundabilities(res) {
  if (!res || typeof res !== "object") return null;

  const candidates = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === "object") {
      const txId = node.transactionId || node.paymentId || node.id;
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
        candidates.push({
          transactionId: txId,
          state: normalizeState(stateStr),
          reason: node.nonRefundableReason || node.reason || rawState?.reason || null,
        });
      }
      Object.values(node).forEach(visit);
    }
  };
  visit(res);

  if (!candidates.length) return null;
  const map = {};
  for (const c of candidates) map[c.transactionId] = { state: c.state, reason: c.reason };
  return map;
}

function normalizeState(raw) {
  const s = String(raw).toUpperCase();
  if (s.includes("MANUAL")) return MANUALLY_REFUNDABLE;
  if (s.includes("NON") || s.includes("NOT_REFUND")) return NON_REFUNDABLE;
  if (s.includes("REFUND")) return REFUNDABLE;
  return s;
}

function registerRefundTools(server) {
  server.tool(
    "get_order_refundability",
    "Check whether an order's payments can be refunded through the Wix API before attempting a " +
      "refund. Each payment is REFUNDABLE (the provider supports an API refund), " +
      "MANUALLY_REFUNDABLE (refund the customer outside Wix, then record it with " +
      "refund_order externalRefund=true), or NON_REFUNDABLE (e.g. already fully refunded).",
    { orderId: z.string().describe("Wix order ID.") },
    async ({ orderId }) => {
      try {
        const res = await wixApi("POST", "/ecom/v1/order-billing/get-order-refundability", {
          body: { orderId },
        });
        return ok(res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "refund_order",
    "Refund one or more payments on a Wix order. For a full refund of a payment, pass just its " +
      "transactionId; for a partial refund also pass `amount`. If the payment provider can't be " +
      "refunded via API, this returns a clear fallback (refunded=false) telling you to refund the " +
      "customer manually and re-call with externalRefund=true to record it — it never fails " +
      "silently. Get transaction IDs from get_order_transactions.",
    {
      orderId: z.string().describe("Wix order ID."),
      refunds: z
        .array(
          z.object({
            transactionId: z
              .string()
              .describe("Payment transaction ID from get_order_transactions."),
            amount: z
              .string()
              .optional()
              .describe(
                'Partial-refund amount in major units as a decimal string (e.g. "10.50"). ' +
                  "Omit to refund the payment's full remaining amount.",
              ),
          }),
        )
        .min(1)
        .describe("The payments to refund."),
      externalRefund: z
        .boolean()
        .optional()
        .describe(
          "Set true when you have ALREADY refunded the customer outside Wix (provider not " +
            "API-refundable). Records the refund against the order without calling the provider.",
        ),
      restockItems: z
        .boolean()
        .optional()
        .describe("Also restock the refunded items into inventory (default false)."),
      sendEmail: z
        .boolean()
        .optional()
        .describe("Send the buyer Wix's order-refunded email (default false)."),
    },
    async ({ orderId, refunds, externalRefund, restockItems, sendEmail }) => {
      try {
        const targetIds = refunds.map((r) => r.transactionId);

        // When this isn't already a manual/external refund, check refundability so
        // we surface a clear fallback instead of firing a provider call that will fail.
        if (!externalRefund) {
          let refundability = null;
          try {
            const check = await wixApi("POST", "/ecom/v1/order-billing/get-order-refundability", {
              body: { orderId },
            });
            refundability = parseRefundabilities(check);
          } catch (checkErr) {
            // Best-effort: if the check itself fails, fall through and let the
            // refund attempt produce the authoritative error.
            console.error(`[wix] refundability check failed, proceeding: ${checkErr.message}`);
          }

          if (refundability) {
            const blocked = targetIds
              .map((id) => ({ id, ...(refundability[id] || {}) }))
              .filter((t) => t.state && t.state !== REFUNDABLE);

            if (blocked.length) {
              const manual = blocked.filter((t) => t.state === MANUALLY_REFUNDABLE);
              const none = blocked.filter((t) => t.state === NON_REFUNDABLE);
              const lines = [];
              if (manual.length) {
                lines.push(
                  `This order's payment provider does not support API refunds for ` +
                    `transaction(s) ${manual.map((t) => t.id).join(", ")}. Refund the customer ` +
                    `manually in your payment provider, then call refund_order again with ` +
                    `externalRefund=true to record it against the order.`,
                );
              }
              if (none.length) {
                lines.push(
                  `Transaction(s) ${none
                    .map((t) => (t.reason ? `${t.id} (${t.reason})` : t.id))
                    .join(", ")} cannot be refunded (e.g. already fully refunded).`,
                );
              }
              return ok({
                refunded: false,
                reason: "provider_not_api_refundable",
                refundability: blocked,
                message: lines.join(" "),
              });
            }
          }
        }

        const body = {
          orderId,
          paymentRefunds: refunds.map((r) => ({
            transactionId: r.transactionId,
            ...(r.amount ? { amount: money(r.amount) } : {}),
            ...(externalRefund ? { externalRefund: true } : {}),
          })),
          sideEffects: {
            restockAllItems: Boolean(restockItems),
            sendOrderRefundedEmail: Boolean(sendEmail),
          },
        };

        const res = await wixApi("POST", "/ecom/v1/order-billing/refund-payments", { body });
        return ok({
          refunded: true,
          external: Boolean(externalRefund),
          result: res,
        });
      } catch (err) {
        // Don't fail silently: append the external-refund fallback hint so the
        // playbook has an actionable next step on a provider/permission error.
        const base = err?.message || String(err);
        return fail(
          new Error(
            `${base}. If this payment provider does not support API refunds, refund the ` +
              `customer manually and re-call refund_order with externalRefund=true to record it.`,
          ),
        );
      }
    },
  );
}

module.exports = { registerRefundTools };

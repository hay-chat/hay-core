/**
 * Goodwill coupon — POST /coupons, bounded in code (Roger, D16: coupons on,
 * with a merchant-set cap as a percentage and/or a fixed amount).
 *
 * Bounds enforced here, never in the prompt:
 *   - the merchant's cap: percentage coupons ≤ couponMaxPercent, fixed coupons
 *     ≤ couponMaxAmount (store currency). A cap of 0 / empty turns that type off;
 *     anything above the cap is refused and needs a person (D4 approval);
 *   - single use (max_uses 1), short expiry (≤ couponMaxDays), does not combine
 *     with other promotions, does not discount shipping;
 *   - the code is generated here (the agent cannot pick a vanity code);
 *   - when tied to an order: at most one Hay.chat coupon per order, recorded on the
 *     order note.
 *
 * Nuvemshop coupons cannot be restricted to one customer's email
 * (first_consumer_purchase is the only shopper rule), and a percentage coupon
 * has no currency ceiling; both are documented limits, not bugs.
 *
 * Env (from plugin config): NUVEMSHOP_COUPONS_ENABLED, NUVEMSHOP_COUPON_MAX_PERCENT,
 * NUVEMSHOP_COUPON_MAX_AMOUNT, NUVEMSHOP_COUPON_MAX_DAYS.
 */

const crypto = require("node:crypto");
const { z } = require("zod");
const { nsApi } = require("../lib/client");
const { ok, fail, toolError, WRITE } = require("../lib/format");
const { resolveOrder } = require("../lib/orders");
const { appendOwnerNote } = require("./orders");

const DEFAULTS = { maxPercent: 10, maxAmount: 0, maxDays: 30 };
const COUPON_MARKER = "HAY COUPON";

function readPositive(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function couponPolicy() {
  const enabled = !["false", "0", "off", "no"].includes(
    String(process.env.NUVEMSHOP_COUPONS_ENABLED ?? "true").toLowerCase(),
  );
  return {
    enabled,
    maxPercent: Math.min(readPositive("NUVEMSHOP_COUPON_MAX_PERCENT", DEFAULTS.maxPercent), 100),
    maxAmount: readPositive("NUVEMSHOP_COUPON_MAX_AMOUNT", DEFAULTS.maxAmount),
    maxDays: Math.max(
      1,
      Math.min(readPositive("NUVEMSHOP_COUPON_MAX_DAYS", DEFAULTS.maxDays), 365),
    ),
  };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function generateCode() {
  const bytes = crypto.randomBytes(8);
  let s = "HAY";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

const ymd = (d) => d.toISOString().slice(0, 10);

function registerCouponTools(server) {
  server.registerTool(
    "nuvemshop_create_coupon",
    {
      description:
        "Create a single-use goodwill coupon (WRITE), e.g. an apology for a late parcel. The " +
        "merchant's cap is enforced: a percentage up to the configured maximum and/or a fixed " +
        "amount up to the configured maximum; anything above is refused and needs a person. " +
        "The code is generated for you, expires within the configured days and does not " +
        "combine with other promotions. Pass the order it compensates so it is recorded there.",
      inputSchema: {
        type: z
          .enum(["percentage", "absolute"])
          .describe("percentage = % off; absolute = fixed amount off."),
        value: z
          .number()
          .positive()
          .describe("Percent (e.g. 10) or amount in store currency (e.g. 20)."),
        reason: z
          .string()
          .min(3)
          .max(300)
          .describe("Why the coupon is given (stored on the order)."),
        order_id: z.string().optional().describe("Order the coupon compensates (internal id)."),
        order_number: z
          .string()
          .optional()
          .describe("Order the coupon compensates (customer-facing number)."),
        valid_days: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Days until it expires (default and max: the merchant's setting)."),
        min_price: z
          .number()
          .nonnegative()
          .optional()
          .describe("Minimum cart total for the coupon to apply."),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const policy = couponPolicy();
        if (!policy.enabled) {
          throw toolError(
            "PRECONDITION",
            "Coupons are turned off for this store. Hand off to a person if a goodwill gesture is needed.",
          );
        }
        const cap = args.type === "percentage" ? policy.maxPercent : policy.maxAmount;
        const unit = args.type === "percentage" ? "%" : " (store currency)";
        if (!cap) {
          throw toolError(
            "PRECONDITION",
            `${args.type === "percentage" ? "Percentage" : "Fixed-amount"} coupons are not enabled ` +
              "by the merchant's coupon cap. " +
              (args.type === "percentage" && policy.maxAmount
                ? `Use a fixed amount up to ${policy.maxAmount}.`
                : args.type === "absolute" && policy.maxPercent
                  ? `Use a percentage up to ${policy.maxPercent}%.`
                  : ""),
          );
        }
        if (args.value > cap) {
          throw toolError(
            "PRECONDITION",
            `A ${args.value}${unit} coupon is above the merchant's cap of ${cap}${unit}. It needs ` +
              "a person's approval: hand off instead of creating it.",
          );
        }
        const days = Math.min(args.valid_days ?? policy.maxDays, policy.maxDays);

        let order = null;
        if (args.order_id || args.order_number) {
          order = await resolveOrder(args);
          if (String(order.owner_note || "").includes(COUPON_MARKER)) {
            throw toolError(
              "PRECONDITION",
              `Order #${order.number} already received a Hay.chat goodwill coupon. One per order; ` +
                "hand off if the customer needs more.",
            );
          }
        }

        const now = new Date();
        const end = new Date(now.getTime() + days * 86400000);
        const body = {
          code: generateCode(),
          type: args.type,
          value: args.value.toFixed(2),
          valid: true,
          max_uses: 1,
          start_date: ymd(now),
          end_date: ymd(end),
          includes_shipping: false,
          combines_with_other_discounts: false,
          first_consumer_purchase: false,
        };
        if (args.min_price !== undefined) body.min_price = args.min_price;
        const coupon = await nsApi("POST", "/coupons", { body });

        let ownerNote = null;
        if (order) {
          ownerNote = await appendOwnerNote(
            order,
            `${COUPON_MARKER} ${coupon?.code ?? body.code}: ${args.value}${args.type === "percentage" ? "%" : ` ${order.currency}`} ` +
              `off, single use, until ${body.end_date}. Reason: ${args.reason}`,
          );
        }
        return ok({
          created: true,
          couponId: coupon?.id ?? null,
          code: coupon?.code ?? body.code,
          type: args.type,
          value: body.value,
          maxUses: 1,
          validUntil: body.end_date,
          minPrice: body.min_price ?? null,
          combinesWithOtherDiscounts: false,
          orderNumber: order?.number ?? null,
          ownerNote,
          note:
            "Nuvemshop cannot restrict a coupon to one customer: whoever has the code can use " +
            "it once. Share it only with this customer.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCouponTools, couponPolicy, generateCode, COUPON_MARKER };

/**
 * Goodwill coupon — POST /coupons, bounded in code (Roger, D16: coupons on,
 * with a merchant-set cap as a percentage and/or a fixed amount).
 *
 * Bounds enforced here, never in the prompt:
 *   - the merchant's cap: percentage coupons ≤ couponMaxPercent, fixed coupons
 *     ≤ couponMaxAmount (store currency). A cap of 0 / empty turns that type off.
 *     Above the cap the tool refuses with NEEDS_APPROVAL; it is in the risk
 *     spec's `capped` list, so core holds the call for a person and re-runs it
 *     with hay_approval_id once approved (@hay/plugin-sdk/coupon-policy);
 *   - single use (max_uses 1), short expiry (≤ couponMaxDays), does not combine
 *     with other promotions, does not discount shipping;
 *   - the code is generated here (the agent cannot pick a vanity code);
 *   - always tied to an order (Nuvemshop cannot restrict a coupon to an email, so
 *     the order is what bounds it): at most one Hay.chat coupon per order;
 *   - the shopper's email must match the order's contact/customer email, so a
 *     shopper cannot farm coupons by guessing other order numbers;
 *   - the order note marker is written BEFORE the coupon is created: if the
 *     note fails nothing is issued, and if the coupon then fails the order stays
 *     marked (fail closed) and the agent hands off.
 *
 * Nuvemshop coupons cannot be restricted to one customer's email
 * (first_consumer_purchase is the only shopper rule), and a percentage coupon
 * has no currency ceiling; both are documented limits, not bugs.
 *
 * Env (from plugin config): NUVEMSHOP_COUPONS_ENABLED, NUVEMSHOP_COUPON_MAX_PERCENT,
 * NUVEMSHOP_COUPON_MAX_AMOUNT, NUVEMSHOP_COUPON_MAX_DAYS.
 */

const { z } = require("zod");
const {
  readCouponPolicy,
  enforceCouponCap,
  couponExpiry,
  generateCouponCode,
} = require("@hay/plugin-sdk/coupon-policy");
const { APPROVAL_ARG } = require("@hay/plugin-sdk/tool-risk");
const { toToolError } = require("@hay/plugin-sdk/tool-errors");
const { nsApi } = require("../lib/client");
const { ok, fail, toolError, sameEmail, WRITE } = require("../lib/format");
const { resolveOrder } = require("../lib/orders");
const { appendOwnerNote } = require("./orders");

const COUPON_MARKER = "HAY COUPON";

const couponPolicy = () => readCouponPolicy("NUVEMSHOP_");

const ymd = (d) => d.toISOString().slice(0, 10);

function registerCouponTools(server) {
  server.registerTool(
    "nuvemshop_create_coupon",
    {
      description:
        "Create a single-use goodwill coupon (WRITE), e.g. an apology for a late parcel. The " +
        "merchant's cap is enforced: a percentage up to the configured maximum and/or a fixed " +
        "amount up to the configured maximum; above it the tool returns NEEDS_APPROVAL and a " +
        "team member must approve it first. The code is generated for you, expires within the " +
        "configured days and does not combine with other promotions. One coupon per order: " +
        "pass the order it compensates and the email the customer gave you, which must match " +
        "the order.",
      inputSchema: {
        email: z
          .string()
          .describe("Email the customer gave you in this conversation; must match the order."),
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
        order_id: z
          .string()
          .optional()
          .describe("Order the coupon compensates (internal id). This or order_number is required."),
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
        [APPROVAL_ARG]: z
          .string()
          .optional()
          .describe("Set by Hay.chat on an approved request. Never set this yourself."),
      },
      annotations: WRITE,
    },
    async (args) => {
      try {
        const policy = couponPolicy();
        enforceCouponCap(args, policy, { approved: Boolean(args[APPROVAL_ARG]) });
        if (!args.order_id && !args.order_number) {
          throw toolError(
            "BAD_INPUT",
            "Pass the order the coupon compensates (order_id or order_number): Nuvemshop " +
              "coupons cannot be tied to one customer, so each order gets at most one.",
          );
        }
        const order = await resolveOrder(args);
        if (![order.contact_email, order.customer?.email].some((e) => sameEmail(e, args.email))) {
          throw toolError(
            "PRECONDITION",
            `The email given does not match order #${order.number}. A goodwill coupon can only ` +
              "be given to the customer who placed the order; ask them to confirm the email used " +
              "at checkout, or hand off.",
            { details: { reason: "CUSTOMER_MISMATCH" } },
          );
        }
        if (String(order.owner_note || "").includes(COUPON_MARKER)) {
          throw toolError(
            "PRECONDITION",
            `Order #${order.number} already received a Hay.chat goodwill coupon. One per order; ` +
              "hand off if the customer needs more.",
            { details: { reason: "ALREADY_HAS_COUPON" } },
          );
        }

        const now = new Date();
        const end = couponExpiry(policy, args.valid_days, now);
        const body = {
          code: generateCouponCode(),
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

        // Mark the order first: a failed note issues nothing, and a failed coupon
        // leaves the order marked, so it can never be re-issued by retrying.
        const ownerNote = await appendOwnerNote(
          order,
          `${COUPON_MARKER} ${body.code}: ${args.value}${args.type === "percentage" ? "%" : ` ${order.currency}`} ` +
            `off, single use, until ${body.end_date}. Reason: ${args.reason}` +
            (args[APPROVAL_ARG] ? " (approved by a team member)" : ""),
        );
        let coupon;
        try {
          coupon = await nsApi("POST", "/coupons", { body });
        } catch (err) {
          const e = toToolError(err);
          throw toolError(
            e.code,
            `${e.message}. Order #${order.number} is already marked as compensated, so do not ` +
              "retry: hand off to a person.",
            { details: { ...e.details, reason: "COUPON_CREATE_FAILED" }, retryable: false },
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
          orderNumber: order.number,
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

module.exports = { registerCouponTools, couponPolicy, COUPON_MARKER };

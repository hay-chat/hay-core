/**
 * Goodwill coupon (D16-4/5/6) — POST /coupons, bounded in code, never in the prompt.
 *
 *   woocommerce_create_coupon   GET /coupons?search=HAY, POST /coupons,
 *                               POST /orders/{id}/notes (when tied to an order)
 *
 * Bounds:
 *   - the merchant's cap (@hay/plugin-sdk/coupon-policy): percentage ≤
 *     WOOCOMMERCE_COUPON_MAX_PERCENT, fixed ≤ WOOCOMMERCE_COUPON_MAX_AMOUNT (store
 *     currency; 0 turns a type off). Above it the tool refuses with NEEDS_APPROVAL;
 *     the tool is in tool-risk.js `capped`, so core holds the call for a person and
 *     re-runs it with hay_approval_id once approved. Only the cap steps aside then;
 *   - single use, restricted to the customer's email (usage_limit 1,
 *     usage_limit_per_user 1, email_restrictions), not combinable (individual_use);
 *   - expiry within WOOCOMMERCE_COUPON_MAX_DAYS;
 *   - the code is generated here (no vanity codes);
 *   - one active Hay.chat coupon per customer email: the MCP does not know the
 *     conversation, so an unused, unexpired goodwill coupon for the same email
 *     blocks another one (approved or not);
 *   - when tied to an order, the order must belong to that email, and the coupon
 *     is recorded as a private order note.
 */

const { z } = require("zod");
const {
  readCouponPolicy,
  enforceCouponCap,
  couponExpiry,
  generateCouponCode,
} = require("@hay/plugin-sdk/coupon-policy");
const { APPROVAL_ARG } = require("@hay/plugin-sdk/tool-risk");
const { wcApi, wcList } = require("../lib/client");
const { ok, fail, toolError } = require("../lib/format");
const { resolveOrder } = require("../lib/orders");

/** Coupon meta key that marks a coupon Hay.chat created (value: the reason). */
const GOODWILL_META_KEY = "_hay_goodwill";
const CODE_PREFIX = "HAY";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const couponPolicy = () => readCouponPolicy("WOOCOMMERCE_");

const isGoodwill = (coupon) =>
  String(coupon.code || "")
    .toUpperCase()
    .startsWith(CODE_PREFIX) && (coupon.meta_data || []).some((m) => m.key === GOODWILL_META_KEY);

/** Unused and not expired. WooCommerce reports `date_expires_gmt` without a zone. */
function isActive(coupon, now) {
  const limit = Number(coupon.usage_limit || 0);
  if (limit && Number(coupon.usage_count || 0) >= limit) return false;
  const expires = coupon.date_expires_gmt || coupon.date_expires;
  if (!expires) return true;
  const ms = Date.parse(/Z|[+-]\d\d:\d\d$/.test(expires) ? expires : `${expires}Z`);
  return !Number.isFinite(ms) || ms > now.getTime();
}

/** The customer's active Hay.chat goodwill coupon, if any. */
async function findActiveGoodwill(email, now) {
  const { items } = await wcList("/coupons", {
    search: CODE_PREFIX,
    per_page: 100,
    orderby: "date",
    order: "desc",
  });
  return (
    items.find(
      (c) =>
        isGoodwill(c) &&
        (c.email_restrictions || []).some((e) => String(e).toLowerCase() === email) &&
        isActive(c, now),
    ) || null
  );
}

function registerCouponTools(server) {
  server.tool(
    "woocommerce_create_coupon",
    "Create a single-use goodwill coupon (WRITE), e.g. an apology for a late parcel. It only " +
      "works for the customer's email, does not combine with other coupons and expires within " +
      "the merchant's limit. The merchant's cap is enforced: a percentage and/or a fixed amount " +
      "up to the configured maximum; above it the tool returns NEEDS_APPROVAL and a team member " +
      "must approve it first. The code is generated for you. One active coupon per customer.",
    {
      email: z.string().describe("The customer's email (the coupon only works for it)."),
      type: z
        .enum(["percentage", "absolute"])
        .describe("percentage = % off the cart; absolute = fixed amount off the cart."),
      value: z
        .number()
        .positive()
        .describe("Percent (e.g. 10) or amount in store currency (e.g. 20)."),
      reason: z.string().min(3).max(300).describe("Why the coupon is given (stored with it)."),
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
      [APPROVAL_ARG]: z
        .string()
        .optional()
        .describe("Set by Hay.chat on an approved request. Never set this yourself."),
    },
    async (args) => {
      try {
        const policy = couponPolicy();
        const approved = Boolean(args[APPROVAL_ARG]);
        enforceCouponCap(args, policy, { approved });
        const email = String(args.email).trim().toLowerCase();
        if (!EMAIL_RE.test(email)) {
          throw toolError("BAD_INPUT", `"${args.email}" is not an email address.`);
        }

        const order = args.order_id || args.order_number ? await resolveOrder(args) : null;
        if (order && String(order.billing?.email || "").toLowerCase() !== email) {
          throw toolError(
            "PRECONDITION",
            `Order #${order.number} was not placed with ${email}. A goodwill coupon can only be ` +
              "given to the customer who placed the order.",
            { details: { reason: "EMAIL_MISMATCH" } },
          );
        }

        const now = new Date();
        const existing = await findActiveGoodwill(email, now);
        if (existing) {
          throw toolError(
            "PRECONDITION",
            `${email} already has an unused Hay.chat goodwill coupon (${String(existing.code).toUpperCase()}). ` +
              "One at a time; hand off if the customer needs more.",
            {
              details: { reason: "ALREADY_HAS_COUPON", code: String(existing.code).toUpperCase() },
            },
          );
        }

        const expires = couponExpiry(policy, args.valid_days, now);
        const code = generateCouponCode(CODE_PREFIX);
        const amount = args.value.toFixed(2);
        const coupon = await wcApi("POST", "/coupons", {
          body: {
            code,
            discount_type: args.type === "percentage" ? "percent" : "fixed_cart",
            amount,
            individual_use: true,
            usage_limit: 1,
            usage_limit_per_user: 1,
            email_restrictions: [email],
            free_shipping: false,
            // Store-local time; WooCommerce ignores date_expires_gmt on write.
            date_expires: expires.toISOString().slice(0, 19),
            description: `Hay.chat goodwill coupon. Reason: ${args.reason}`,
            meta_data: [{ key: GOODWILL_META_KEY, value: args.reason }],
          },
        });

        const finalCode = String(coupon?.code || code).toUpperCase();
        const off =
          args.type === "percentage" ? `${amount}%` : `${amount} ${order?.currency || ""}`.trim();
        if (order) {
          await wcApi("POST", `/orders/${order.id}/notes`, {
            body: {
              note:
                `[Hay.chat] Goodwill coupon ${finalCode}: ${off} off, single use, for ${email}, ` +
                `until ${expires.toISOString().slice(0, 10)}. Reason: ${args.reason}` +
                (approved ? " (approved by a team member)" : ""),
              customer_note: false,
            },
          });
        }

        return ok({
          created: true,
          couponId: coupon?.id ?? null,
          code: finalCode,
          type: args.type,
          value: amount,
          usageLimit: 1,
          restrictedToEmail: email,
          validUntil: expires.toISOString().slice(0, 10),
          combinesWithOtherCoupons: false,
          orderNumber: order?.number ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCouponTools, couponPolicy, GOODWILL_META_KEY };

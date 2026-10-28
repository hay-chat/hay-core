/**
 * Goodwill coupon policy (D16-4/5/6), shared by the commerce plugins so every
 * store enforces the same bounds in code, never in the prompt.
 *
 * Default cap (Roger, D16: coupons ON with a merchant-customisable cap):
 *   - percentage coupons up to 10% — a common apology gesture that scales with
 *     the order instead of a currency-specific number;
 *   - fixed-amount coupons OFF (0) until the merchant sets a ceiling in their own
 *     currency (a single default cannot fit BRL, EUR and USD stores alike);
 *   - expiry within 30 days.
 *
 * Above the cap the tool refuses with NEEDS_APPROVAL. A tool that declares
 * itself in the risk spec's `capped` list gets `_meta["chat.hay/capEnforced"]`,
 * and Hay.chat core then holds the refused call as a pending action; once a
 * person approves it, core re-runs it with `hay_approval_id` set (APPROVAL_ARG)
 * and only then does the cap step aside. Every other bound still applies.
 *
 * Env, per plugin prefix (e.g. "WOOCOMMERCE_"): <P>COUPONS_ENABLED,
 * <P>COUPON_MAX_PERCENT, <P>COUPON_MAX_AMOUNT, <P>COUPON_MAX_DAYS.
 */

const crypto = require("node:crypto");
const { toolError } = require("../tool-errors/index.cjs");

const COUPON_DEFAULTS = Object.freeze({ maxPercent: 10, maxAmount: 0, maxDays: 30 });
const MAX_DAYS_CEILING = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function readNonNegative(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The merchant's coupon policy from env, with safe defaults for bad values. */
function readCouponPolicy(prefix, env = process.env) {
  const enabled = !["false", "0", "off", "no"].includes(
    String(env[`${prefix}COUPONS_ENABLED`] ?? "true").toLowerCase(),
  );
  return {
    enabled,
    maxPercent: Math.min(
      readNonNegative(env, `${prefix}COUPON_MAX_PERCENT`, COUPON_DEFAULTS.maxPercent),
      100,
    ),
    maxAmount: readNonNegative(env, `${prefix}COUPON_MAX_AMOUNT`, COUPON_DEFAULTS.maxAmount),
    maxDays: Math.max(
      1,
      Math.min(
        readNonNegative(env, `${prefix}COUPON_MAX_DAYS`, COUPON_DEFAULTS.maxDays),
        MAX_DAYS_CEILING,
      ),
    ),
  };
}

/**
 * Throw unless a `{type: "percentage"|"absolute", value}` coupon is allowed.
 *  - coupons off, or this coupon type off (cap 0): PRECONDITION;
 *  - above the cap and not approved: NEEDS_APPROVAL (core holds it for a person);
 *  - a percentage over 100 is BAD_INPUT even when approved.
 * The message never says the request is held: whether it is depends on core.
 */
function enforceCouponCap({ type, value }, policy, { approved = false } = {}) {
  if (!policy.enabled) {
    throw toolError(
      "PRECONDITION",
      "Goodwill coupons are turned off for this store. Hand off to a person if a goodwill " +
        "gesture is needed.",
      { details: { reason: "COUPONS_DISABLED" } },
    );
  }
  if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
    throw toolError("BAD_INPUT", "The coupon value must be a positive number.");
  }
  if (type === "percentage" && value > 100) {
    throw toolError("BAD_INPUT", "A percentage coupon cannot exceed 100%.");
  }
  const percentage = type === "percentage";
  const cap = percentage ? policy.maxPercent : policy.maxAmount;
  if (!cap) {
    const other = percentage
      ? policy.maxAmount && `Use a fixed amount up to ${policy.maxAmount} instead.`
      : policy.maxPercent && `Use a percentage up to ${policy.maxPercent}% instead.`;
    throw toolError(
      "PRECONDITION",
      `${percentage ? "Percentage" : "Fixed-amount"} coupons are turned off by the merchant's ` +
        `coupon cap.${other ? ` ${other}` : ""}`,
      { details: { reason: "COUPON_TYPE_DISABLED" } },
    );
  }
  if (value > cap && !approved) {
    const unit = percentage ? "%" : " (store currency)";
    throw toolError(
      "NEEDS_APPROVAL",
      `A ${value}${unit} coupon is above the merchant's cap of ${cap}${unit}, so a team member ` +
        "has to approve it before it can be created. It has not been created.",
      { details: { type, requested: value, cap, ...(percentage ? {} : { amount: value }) } },
    );
  }
}

/** Expiry within the merchant's maximum: `validDays` is clamped to [1, maxDays]. */
function couponExpiry(policy, validDays, now = new Date()) {
  const days = Math.max(1, Math.min(validDays ?? policy.maxDays, policy.maxDays));
  return new Date(now.getTime() + days * DAY_MS);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** A random code the agent cannot choose (no vanity or guessable codes). */
function generateCouponCode(prefix = "HAY") {
  let code = prefix;
  for (const b of crypto.randomBytes(8)) code += ALPHABET[b % ALPHABET.length];
  return code;
}

module.exports = {
  COUPON_DEFAULTS,
  readCouponPolicy,
  enforceCouponCap,
  couponExpiry,
  generateCouponCode,
};

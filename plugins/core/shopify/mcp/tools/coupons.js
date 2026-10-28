// tools/coupons.js — goodwill coupon (D16-4/5/6), bounded in code, never in the prompt.
//
//   shopify_create_coupon   customers(query) → codeDiscountNodes(query) →
//                           discountCodeBasicCreate (+ orderUpdate note when tied to an order)
//   Needs the write_discounts scope (managed app re-consent: see src/index.ts scopes).
//
// Bounds:
//   - the merchant's cap (@hay/plugin-sdk/coupon-policy): percentage ≤
//     SHOPIFY_COUPON_MAX_PERCENT, fixed ≤ SHOPIFY_COUPON_MAX_AMOUNT (shop currency;
//     0 turns a type off). Above it the tool refuses with NEEDS_APPROVAL; it is in
//     tool-risk.js `capped`, so core holds the call for a person and re-runs it
//     with hay_approval_id once approved. Only the cap steps aside then;
//   - single use, only for this customer (usageLimit 1, appliesOncePerCustomer,
//     context.customers), combines with no other discount;
//   - expiry within SHOPIFY_COUPON_MAX_DAYS; the code is generated here;
//   - one active Hay.chat coupon per customer: the MCP does not know the
//     conversation, so an unused, unexpired goodwill discount for the same
//     customer (matched by the customer id in its title) blocks another one;
//   - when tied to an order, the order must belong to that customer, and the
//     coupon is appended to the order's note.

const { z } = require("zod");
const {
  readCouponPolicy,
  enforceCouponCap,
  couponExpiry,
  generateCouponCode,
} = require("@hay/plugin-sdk/coupon-policy");
const { APPROVAL_ARG } = require("@hay/plugin-sdk/tool-risk");
const { shopifyGql } = require("../lib/client");
const {
  ok,
  fail,
  toolError,
  unwrapConnection,
  pageInfo,
  toGid,
  assertNoUserErrors,
} = require("../lib/format");

const TITLE_PREFIX = "Hay.chat goodwill coupon";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const couponPolicy = () => readCouponPolicy("SHOPIFY_");

/** Title that marks a Hay.chat discount and names its customer (numeric id). */
const goodwillTitle = (customerGid) => `${TITLE_PREFIX} · customer ${customerGid.split("/").pop()}`;

async function findCustomer(email) {
  const data = await shopifyGql(
    `
    query FindCouponCustomer($query: String!) {
      customers(first: 5, query: $query) {
        nodes { id defaultEmailAddress { emailAddress } }
      }
    }
  `,
    { query: `email:"${email}"` },
  );
  return (
    unwrapConnection(data.customers).find(
      (c) => String(c.defaultEmailAddress?.emailAddress || "").toLowerCase() === email,
    ) || null
  );
}

/** Unused (by count) and not past its end date. */
function isActive(discount, now) {
  if (discount.status && discount.status !== "ACTIVE" && discount.status !== "SCHEDULED") {
    return false;
  }
  const limit = Number(discount.usageLimit || 0);
  if (limit && Number(discount.asyncUsageCount || 0) >= limit) return false;
  return !discount.endsAt || Date.parse(discount.endsAt) > now.getTime();
}

// Pages scanned for an existing goodwill coupon before failing closed.
const GOODWILL_PAGE_SIZE = 50;
const GOODWILL_MAX_PAGES = 10;

async function findActiveGoodwill(customerGid, now) {
  const title = goodwillTitle(customerGid);
  // Search for this customer's own title and page through every hit: the
  // store-wide newest-N would let a busy store hand out a second code. The
  // search is fuzzy (tokenised), so the exact title match below is what
  // enforces the bound.
  let after = null;
  for (let page = 0; page < GOODWILL_MAX_PAGES; page++) {
    const data = await shopifyGql(
      `
      query FindGoodwillDiscounts($query: String!, $first: Int!, $after: String) {
        codeDiscountNodes(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                status
                endsAt
                usageLimit
                asyncUsageCount
                codes(first: 1) { nodes { code } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
      { query: `title:"${title}"`, first: GOODWILL_PAGE_SIZE, after },
    );
    const match = unwrapConnection(data.codeDiscountNodes).find(
      (n) => n.codeDiscount?.title === title && isActive(n.codeDiscount, now),
    );
    if (match) return match.codeDiscount;
    const info = pageInfo(data.codeDiscountNodes);
    if (!info.hasNextPage || !info.endCursor) return null;
    after = info.endCursor;
  }
  // Could not see every candidate: fail closed rather than risk a second code.
  throw toolError(
    "PRECONDITION",
    "Could not confirm this customer has no unused Hay.chat goodwill coupon. Hand off to a person.",
    { details: { reason: "GOODWILL_CHECK_INCOMPLETE" } },
  );
}

async function getOrder(orderId) {
  const data = await shopifyGql(
    `
    query GetCouponOrder($id: ID!) {
      order(id: $id) { id name note currencyCode customer { id } }
    }
  `,
    { id: toGid("Order", orderId) },
  );
  if (!data.order) {
    throw toolError("NOT_FOUND", `Order ${orderId} not found. Use the order GID or numeric id.`);
  }
  return data.order;
}

async function appendOrderNote(order, text) {
  const note = order.note?.trim() ? `${order.note.trimEnd()}\n\n${text}` : text;
  const data = await shopifyGql(
    `
    mutation AddCouponOrderNote($id: ID!, $note: String!) {
      orderUpdate(input: { id: $id, note: $note }) {
        order { id }
        userErrors { field message }
      }
    }
  `,
    { id: order.id, note },
  );
  assertNoUserErrors(data.orderUpdate);
}

function registerCouponTools(server) {
  server.tool(
    "shopify_create_coupon",
    "Create a single-use goodwill discount code (WRITE), e.g. an apology for a late parcel. It " +
      "only works for the customer with this email, combines with no other discount and expires " +
      "within the merchant's limit. The merchant's cap is enforced: a percentage and/or a fixed " +
      "amount up to the configured maximum; above it the tool returns NEEDS_APPROVAL and a team " +
      "member must approve it first. The code is generated for you. One active coupon per " +
      "customer.",
    {
      email: z.string().describe("The customer's email (the code only works for them)."),
      type: z
        .enum(["percentage", "absolute"])
        .describe("percentage = % off the order; absolute = fixed amount off the order."),
      value: z
        .number()
        .positive()
        .describe("Percent (e.g. 10) or amount in shop currency (e.g. 20)."),
      reason: z.string().min(3).max(300).describe("Why the coupon is given."),
      order_id: z
        .string()
        .optional()
        .describe("Order GID or numeric id the coupon compensates (noted on the order)."),
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

        const customer = await findCustomer(email);
        if (!customer) {
          throw toolError(
            "PRECONDITION",
            `No Shopify customer uses ${email}, so a code restricted to them cannot be made. ` +
              "Hand off if a goodwill gesture is still needed.",
            { details: { reason: "NO_CUSTOMER" } },
          );
        }
        const order = args.order_id ? await getOrder(args.order_id) : null;
        if (order && order.customer?.id !== customer.id) {
          throw toolError(
            "PRECONDITION",
            `Order ${order.name} does not belong to ${email}. A goodwill coupon can only be given ` +
              "to the customer who placed the order.",
            { details: { reason: "CUSTOMER_MISMATCH" } },
          );
        }

        const now = new Date();
        const existing = await findActiveGoodwill(customer.id, now);
        if (existing) {
          const code = existing.codes?.nodes?.[0]?.code ?? null;
          throw toolError(
            "PRECONDITION",
            `${email} already has an unused Hay.chat goodwill coupon${code ? ` (${code})` : ""}. ` +
              "One at a time; hand off if the customer needs more.",
            { details: { reason: "ALREADY_HAS_COUPON", code } },
          );
        }

        const endsAt = couponExpiry(policy, args.valid_days, now);
        const code = generateCouponCode();
        const amount = args.value.toFixed(2);
        const data = await shopifyGql(
          `
          mutation CreateGoodwillDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
              codeDiscountNode { id }
              userErrors { field code message }
            }
          }
        `,
          {
            basicCodeDiscount: {
              title: goodwillTitle(customer.id),
              code,
              startsAt: now.toISOString(),
              endsAt: endsAt.toISOString(),
              usageLimit: 1,
              appliesOncePerCustomer: true,
              context: { customers: { add: [customer.id] } },
              combinesWith: {
                orderDiscounts: false,
                productDiscounts: false,
                shippingDiscounts: false,
              },
              customerGets: {
                value:
                  args.type === "percentage"
                    ? { percentage: args.value / 100 }
                    : { discountAmount: { amount, appliesOnEachItem: false } },
                items: { all: true },
              },
            },
          },
        );
        assertNoUserErrors(data.discountCodeBasicCreate);

        const off =
          args.type === "percentage"
            ? `${amount}%`
            : `${amount} ${order?.currencyCode || ""}`.trim();
        if (order) {
          await appendOrderNote(
            order,
            `[Hay.chat] Goodwill coupon ${code}: ${off} off, single use, for ${email}, until ` +
              `${endsAt.toISOString().slice(0, 10)}. Reason: ${args.reason}` +
              (approved ? " (approved by a team member)" : ""),
          );
        }

        return ok({
          created: true,
          discountId: data.discountCodeBasicCreate.codeDiscountNode?.id ?? null,
          code,
          type: args.type,
          value: amount,
          usageLimit: 1,
          restrictedToCustomer: customer.id,
          validUntil: endsAt.toISOString().slice(0, 10),
          combinesWithOtherDiscounts: false,
          orderName: order?.name ?? null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCouponTools, couponPolicy, goodwillTitle };

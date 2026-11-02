/**
 * Shopper identity checks. The check runs in the tool, not the prompt: without
 * a match nothing is returned.
 *
 *  - matchIdentity: the shopper proves they own an order by giving the email or
 *    phone on it (D10-3 payment links).
 *  - callerIdentity / ownsRecord: the customer Hay.chat core verified for this
 *    conversation (a signed webchat customer, or the sender a channel provider
 *    named), sent with every tool call as `_meta["chat.hay/customer"]`, apart
 *    from the model-written arguments. A tool that returns a customer's personal
 *    data (toolRisk `customerData`) returns only records it matches.
 */

const { toolError } = require("../tool-errors/index.cjs");

/** Where core puts the verified customer in a tool call's MCP `_meta`. */
const CUSTOMER_META_KEY = "chat.hay/customer";

const NOT_VERIFIED =
  "The customer in this conversation is not verified, so customer records cannot be looked up.";
const NOT_THIS_CUSTOMER =
  "That is not the verified customer in this conversation. Only their own records can be looked up.";

const sameEmail = (a, b) =>
  Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const digits = (s) => String(s || "").replace(/\D/g, "");

/** The part of a phone number that survives formatting differences (+55, spaces, area code). */
const phoneKey = (phone) => digits(phone).slice(-8);

const samePhone = (a, b) => {
  const ka = phoneKey(a);
  return ka.length === 8 && ka === phoneKey(b);
};

/**
 * "email" | "phone" when the given email/phone matches one on the order, else null.
 * @param {{ emails: unknown[], phones: unknown[] }} onOrder
 * @param {{ email?: string, phone?: string }} given
 */
function matchIdentity(onOrder, { email, phone } = {}) {
  if (email && (onOrder.emails || []).some((e) => sameEmail(e, email))) return "email";
  if (phone && (onOrder.phones || []).some((p) => samePhone(p, phone))) return "phone";
  return null;
}

/** True when the shopper gave something we can match on. */
const hasIdentity = ({ email, phone } = {}) => Boolean(email) || phoneKey(phone).length === 8;

const str = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * The verified customer core sent with this call, read from the MCP handler's
 * `extra._meta`. Anything missing or malformed reads as `{ trust: "none" }`.
 * @param {{ _meta?: Record<string, unknown> } | undefined} extra
 * @returns {{ trust: "verified", source: string, externalId: string|null, email: string|null, phone: string|null } | { trust: "staff" } | { trust: "none" }}
 */
function callerIdentity(extra) {
  const raw = extra && extra._meta && extra._meta[CUSTOMER_META_KEY];
  if (!raw || typeof raw !== "object") return { trust: "none" };
  if (raw.trust === "staff") return { trust: "staff" };
  if (raw.trust !== "verified") return { trust: "none" };
  return {
    trust: "verified",
    source: String(raw.source || ""),
    externalId: str(raw.externalId),
    email: str(raw.email),
    phone: str(raw.phone),
  };
}

/**
 * May this caller see a record with these emails/phones? Staff see any record;
 * a verified customer only one whose email or phone matches theirs; nobody
 * else sees any.
 * @param {ReturnType<typeof callerIdentity>} identity
 * @param {{ emails: unknown[], phones: unknown[] }} onRecord
 */
function ownsRecord(identity, onRecord) {
  if (identity.trust === "staff") return true;
  if (identity.trust !== "verified") return false;
  return matchIdentity(onRecord, { email: identity.email, phone: identity.phone }) !== null;
}

/**
 * The email/phone a customer lookup may search by: whatever was asked for
 * staff, the verified customer's own otherwise. Asking for anyone else's is
 * refused (PRECONDITION) rather than silently answered with the verified
 * customer's; so is a caller nobody verified.
 * @param {ReturnType<typeof callerIdentity>} identity
 * @param {{ email?: string, phone?: string }} asked
 * @returns {{ email?: string|null, phone?: string|null }}
 */
function lookupFor(identity, { email, phone } = {}) {
  if (identity.trust === "staff") return { email, phone };
  if (identity.trust !== "verified") throw toolError("PRECONDITION", NOT_VERIFIED);
  if (
    (email && !sameEmail(email, identity.email)) ||
    (phone && !samePhone(phone, identity.phone))
  ) {
    throw toolError("PRECONDITION", NOT_THIS_CUSTOMER);
  }
  if (!identity.email && !identity.phone) {
    throw toolError(
      "PRECONDITION",
      "The verified customer has no email or phone on file to look their records up by.",
    );
  }
  return { email: identity.email, phone: identity.phone };
}

/**
 * The email an email-only lookup may search by (see lookupFor). Throws when
 * the verified customer has no email on file; staff get what they asked for.
 * @param {ReturnType<typeof callerIdentity>} identity
 * @param {string | undefined} asked
 * @returns {string}
 */
function verifiedEmail(identity, asked) {
  const { email } = lookupFor(identity, { email: asked });
  if (!email && identity.trust !== "staff") {
    throw toolError(
      "PRECONDITION",
      "The verified customer has no email on file to look their orders up by.",
    );
  }
  return email;
}

/**
 * Throws (PRECONDITION) unless this caller may see a record with these
 * emails/phones (see ownsRecord).
 * @param {ReturnType<typeof callerIdentity>} identity
 * @param {{ emails: unknown[], phones: unknown[] }} onRecord
 */
function assertOwnsRecord(identity, onRecord) {
  if (identity.trust === "none") throw toolError("PRECONDITION", NOT_VERIFIED);
  if (!ownsRecord(identity, onRecord)) throw toolError("PRECONDITION", NOT_THIS_CUSTOMER);
}

module.exports = {
  CUSTOMER_META_KEY,
  NOT_VERIFIED,
  sameEmail,
  samePhone,
  phoneKey,
  digits,
  matchIdentity,
  hasIdentity,
  callerIdentity,
  ownsRecord,
  lookupFor,
  verifiedEmail,
  assertOwnsRecord,
};

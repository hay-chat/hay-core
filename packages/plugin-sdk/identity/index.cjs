/**
 * Shopper identity check for tools that share order details only after the
 * shopper proves they own the order (D10-3 payment links). The check runs in the
 * tool, not the prompt: without a match nothing is returned.
 */

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

module.exports = { sameEmail, samePhone, phoneKey, digits, matchIdentity, hasIdentity };

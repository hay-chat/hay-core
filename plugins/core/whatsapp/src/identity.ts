import type { Recipient } from "./graph-client.js";

/**
 * Customer identity on the WhatsApp channel (PLAN.md D3).
 *
 * `Customer.external_id` is the phone number in E.164 with a leading `+`
 * (`+5511999999999`), built from the webhook's `wa_id`/`from`. Users who hide
 * their number behind a WhatsApp username arrive with only a business-scoped
 * user id (BSUID, `contacts[].user_id`); those are keyed as
 * `whatsapp:bsuid:<user_id>` and addressed with `recipient` instead of `to`.
 */

const BSUID_PREFIX = "whatsapp:bsuid:";

/** External id for an inbound sender, or null when the webhook carries neither id. */
export function customerExternalId(waId?: string, userId?: string): string | null {
  const digits = waId?.replace(/\D/g, "");
  if (digits) {
    return `+${digits}`;
  }
  if (userId) {
    return `${BSUID_PREFIX}${userId}`;
  }
  return null;
}

/** Graph API addressing for a stored external id. */
export function recipientFor(externalId: string): Recipient {
  if (externalId.startsWith(BSUID_PREFIX)) {
    return { recipient: externalId.slice(BSUID_PREFIX.length) };
  }
  const digits = externalId.replace(/\D/g, "");
  return { to: `+${digits}` };
}

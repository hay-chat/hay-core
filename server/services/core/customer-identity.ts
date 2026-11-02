/**
 * The customer a conversation is verifiably with, as core passes it to plugin
 * tools (`_meta["chat.hay/customer"]` on the MCP call, never in the arguments,
 * so the model cannot write it). A tool that returns a customer's personal
 * data (`customerData` in tool-risk) runs only for "verified" or "staff", and
 * the plugin returns only records that match the identity.
 *
 * Where an identity is verified:
 *  - webchat: the store's server signed the customer's external id
 *    (webchat-identity.service), so the conversation links that customer. An
 *    email the shopper typed at hand-off is their claim, not verified, and is
 *    left out (web-follow-up.service marks it with emailConsentSource).
 *  - other channels: the channel plugin resolved the sender from the
 *    provider (a WhatsApp number, an email sender) and stored it under the
 *    customer's `external_metadata[channel]`.
 *  - staff: the dashboard playground and simulation runs, where the org's own
 *    team is typing. Server-set metadata the public widget cannot write.
 * Anything else (an anonymous visitor, a customer record with no channel
 * identity) is "none".
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import { AppDataSource } from "@server/database/data-source";
import { Customer } from "@server/database/entities/customer.entity";

export const CUSTOMER_IDENTITY_META_KEY = "chat.hay/customer";

export type CustomerIdentity =
  | {
      trust: "verified";
      source: "webchat_signature" | "channel";
      externalId: string | null;
      email: string | null;
      phone: string | null;
    }
  | { trust: "staff" }
  | { trust: "none" };

const NONE: CustomerIdentity = { trust: "none" };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isStaffConversation(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.sourceId === "playground" || typeof metadata?.runKind === "string";
}

/** The identity a customer record proves for a conversation on `channel`. */
export function identityFromCustomer(customer: Customer, channel: string): CustomerIdentity {
  const external = customer.external_metadata ?? {};
  if (channel === "web") {
    // Only a signed external id links a store customer to a web conversation.
    if (!customer.external_id) return NONE;
    const web = (external.web ?? {}) as Record<string, unknown>;
    return {
      trust: "verified",
      source: "webchat_signature",
      externalId: customer.external_id,
      email: web.emailConsentSource === "handoff" ? null : text(customer.email),
      phone: text(customer.phone),
    };
  }
  const fromChannel = external[channel];
  if (!fromChannel || typeof fromChannel !== "object") return NONE;
  const channelData = fromChannel as Record<string, unknown>;
  return {
    trust: "verified",
    source: "channel",
    externalId: customer.external_id,
    email: text(channelData.email),
    phone: text(channelData.phone),
  };
}

export async function resolveCustomerIdentity(
  conversation: Pick<Conversation, "organization_id" | "customer_id" | "channel" | "metadata">,
): Promise<CustomerIdentity> {
  if (isStaffConversation(conversation.metadata)) return { trust: "staff" };
  if (!conversation.customer_id) return NONE;
  const customer = await AppDataSource.getRepository(Customer).findOne({
    where: { id: conversation.customer_id, organization_id: conversation.organization_id },
    select: { id: true, external_id: true, email: true, phone: true, external_metadata: true },
  });
  return customer ? identityFromCustomer(customer, conversation.channel ?? "web") : NONE;
}

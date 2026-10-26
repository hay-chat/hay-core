import { createHash } from "node:crypto";

/**
 * Thread identity for the email channel.
 *
 * Every org gets one deterministic ingest alias on Hay's inbound domain. The
 * merchant forwards support@their-store to it. Replies Hay sends carry a
 * Reply-To with the conversation id as a `+c<uuid>` sub-address, so a reply
 * finds its conversation even when the client strips threading headers. The
 * root Message-ID of a thread (first id in References) is the provider-side
 * conversation id core stores and looks up.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function splitAddress(address: string): { local: string; domain: string } {
  const at = address.lastIndexOf("@");
  return at === -1
    ? { local: address, domain: "" }
    : { local: address.slice(0, at), domain: address.slice(at + 1) };
}

/** Deterministic per-org ingest address, e.g. `in-3f9a2b7c1d@inbound.hay.chat`. */
export function ingestAlias(orgId: string, inboundDomain: string): string {
  const digest = createHash("sha256").update(orgId).digest("hex").slice(0, 10);
  return `in-${digest}@${inboundDomain.toLowerCase()}`;
}

/** Reply-To address that pins replies to one conversation. */
export function tokenAddress(alias: string, conversationId: string): string {
  const { local, domain } = splitAddress(alias);
  return `${local}+c${conversationId}@${domain}`;
}

/** Conversation id carried by any recipient address of the form `<alias-local>+c<uuid>@<alias-domain>`. */
export function conversationIdFromRecipients(
  recipients: string[],
  alias: string,
): string | undefined {
  const { local, domain } = splitAddress(alias.toLowerCase());
  const pattern = new RegExp(`^${escapeRegExp(local)}\\+c(${UUID})@${escapeRegExp(domain)}$`, "i");
  for (const recipient of recipients) {
    const match = recipient.trim().toLowerCase().match(pattern);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Provider-side thread id: the first References entry (the thread root),
 * else In-Reply-To, else the message's own id for a brand-new thread.
 */
export function threadRootId(ids: {
  messageId?: string;
  inReplyTo?: string;
  references: string[];
}): string | undefined {
  return ids.references[0] ?? ids.inReplyTo ?? ids.messageId;
}

/** Message-ID Hay stamps on its own outbound email. */
export function outboundMessageId(hayMessageId: string, domain: string): string {
  return `<hay-${hayMessageId}@${domain}>`;
}

export function isHayMessageId(id: string): boolean {
  return /^<hay-/.test(id);
}

/** Subject for a reply: prefix once, keep the original otherwise. */
export function replySubject(subject: string | undefined, fallback: string): string {
  const base = subject?.trim() || fallback;
  return /^(re|res|aw|sv|antw)\s*:/i.test(base) ? base : `Re: ${base}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

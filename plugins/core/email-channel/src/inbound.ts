import type { ChannelContext } from "./context.js";
import { classifyInbound, extractForwardingConfirmation } from "./classify.js";
import {
  headerValue,
  headersFromObject,
  htmlToText,
  normalizeMessageId,
  parseAddress,
  parseAddressList,
  parseHeaderBlock,
  parseMessageIds,
  type HeaderMap,
} from "./mime.js";
import { extractReply } from "./reply-parser.js";
import {
  conversationIdFromRecipients,
  isHayMessageId,
  splitAddress,
  threadRootId,
} from "./thread.js";
import type { ReceivedEmail } from "./resend.js";

/**
 * Turn a Resend `email.received` event into a Hay message.
 *
 * Core has already verified the webhook signature and routed the event to this
 * org by recipient address. We fetch the full email, classify it, resolve the
 * thread (Reply-To token → References/In-Reply-To root → new), strip quoted
 * history, upload attachments and hand it to `messages.receive`.
 */

export interface InboundSummary {
  outcome: "processed" | "deduped" | "ignored" | "held";
  kind?: string;
  reason?: string;
  conversationId?: string;
}

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT_CHARS = 20_000;

interface UploadedAttachment {
  id?: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

interface ConversationMessage {
  type?: string;
  providerMessageId?: string | null;
  metadata?: { mid?: unknown } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Headers from the API response, completed from the raw message when threading headers are missing. */
async function resolveHeaders(email: ReceivedEmail, ctx: ChannelContext): Promise<HeaderMap> {
  const headers = headersFromObject(email.headers);
  const hasThreading =
    headerValue(headers, "in-reply-to") !== undefined ||
    headerValue(headers, "references") !== undefined;
  const resend = ctx.getResend();
  if (hasThreading || !email.raw?.download_url || !resend) {
    return headers;
  }
  try {
    const { buffer } = await resend.download(email.raw.download_url);
    const fromRaw = parseHeaderBlock(buffer.toString("utf8"));
    for (const [name, values] of Object.entries(fromRaw)) {
      headers[name] ??= values;
    }
  } catch (error: unknown) {
    ctx.logger.warn("Could not download raw email for headers", {
      emailId: email.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return headers;
}

async function uploadAttachments(
  email: ReceivedEmail,
  ctx: ChannelContext,
): Promise<UploadedAttachment[]> {
  const resend = ctx.getResend();
  if (!resend || !email.attachments?.length) {
    return [];
  }
  let metas = email.attachments;
  if (!metas.some((meta) => meta.download_url)) {
    try {
      metas = await resend.listAttachments(email.id);
    } catch (error: unknown) {
      ctx.logger.warn("Could not list attachments", {
        emailId: email.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  const uploaded: UploadedAttachment[] = [];
  for (const meta of metas) {
    if (uploaded.length >= MAX_ATTACHMENTS) {
      break;
    }
    if (!meta.download_url || (meta.content_disposition ?? "attachment") === "inline") {
      continue;
    }
    if (meta.size !== undefined && meta.size > MAX_ATTACHMENT_BYTES) {
      ctx.logger.warn("Skipping oversized attachment", {
        filename: meta.filename,
        size: meta.size,
      });
      continue;
    }
    try {
      const { buffer } = await resend.download(meta.download_url);
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        ctx.logger.warn("Skipping oversized attachment", {
          filename: meta.filename,
          size: buffer.length,
        });
        continue;
      }
      const stored = await ctx.api.mutation<UploadedAttachment>("media.upload", {
        data: buffer.toString("base64"),
        mimeType: meta.content_type || "application/octet-stream",
        filename: meta.filename || "attachment",
      });
      uploaded.push(stored);
    } catch (error: unknown) {
      ctx.logger.warn("Attachment upload failed", {
        filename: meta.filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return uploaded;
}

/**
 * A shopper replying to a message we never sent means someone at the store
 * answered from their own mailbox. Only ids that look like they came from the
 * merchant's mail system count, so an id rewritten by the relay cannot cause
 * false alarms.
 */
export function looksLikeMerchantReply(
  inReplyTo: string,
  knownIds: Set<string>,
  merchantDomain: string | null,
): boolean {
  if (knownIds.has(inReplyTo) || isHayMessageId(inReplyTo)) {
    return false;
  }
  const domain = splitAddress(inReplyTo.replace(/^<|>$/g, "")).domain.toLowerCase();
  if (!domain) {
    return false;
  }
  if (merchantDomain && domain === merchantDomain.toLowerCase()) {
    return true;
  }
  return /(^|\.)mail\.gmail\.com$|(^|\.)outlook\.com$|(^|\.)office365\.com$/.test(domain);
}

async function detectOutOfBandReply(
  conversationId: string,
  inReplyTo: string | undefined,
  merchantDomain: string | null,
  ctx: ChannelContext,
): Promise<boolean> {
  if (!inReplyTo) {
    return false;
  }
  try {
    const messages = await ctx.api.query<ConversationMessage[]>("messages.getByConversation", {
      conversationId,
    });
    const knownIds = new Set<string>();
    for (const message of messages) {
      const id = normalizeMessageId(message.providerMessageId ?? message.metadata?.mid);
      if (id) {
        knownIds.add(id);
      }
    }
    return looksLikeMerchantReply(inReplyTo, knownIds, merchantDomain);
  } catch (error: unknown) {
    ctx.logger.warn("Could not load conversation for out-of-band check", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function handleInbound(event: unknown, ctx: ChannelContext): Promise<InboundSummary> {
  const settings = ctx.getSettings();
  const resend = ctx.getResend();
  if (!settings || !resend) {
    return { outcome: "ignored", reason: "not_configured" };
  }
  if (!isRecord(event) || event.type !== "email.received" || !isRecord(event.data)) {
    return { outcome: "ignored", reason: "not_email_received" };
  }
  const emailId = typeof event.data.email_id === "string" ? event.data.email_id : undefined;
  if (!emailId) {
    return { outcome: "ignored", reason: "missing_email_id" };
  }

  const email = await resend.getReceivedEmail(emailId);
  const headers = await resolveHeaders(email, ctx);
  const subject = email.subject ?? "";
  const sender = parseAddress(email.from);
  const text = (email.text ?? "").trim() || htmlToText(email.html ?? "");

  const messageId = normalizeMessageId(email.message_id ?? headerValue(headers, "message-id"));
  const classification = classifyInbound({
    from: email.from,
    subject,
    headers,
    authentication: email.authentication,
    ownAddress: settings.fromAddress,
    messageId,
  });

  if (classification.kind === "forwarding-confirmation") {
    const confirmation = extractForwardingConfirmation(text);
    ctx.state.forwarding = {
      ...confirmation,
      receivedAt: new Date().toISOString(),
      recipient: stringList(email.received_for)[0] ?? stringList(email.to)[0],
    };
    ctx.logger.info("Gmail forwarding confirmation received", { hasCode: !!confirmation.code });
    return { outcome: "ignored", kind: classification.kind };
  }
  if (classification.kind !== "customer") {
    ctx.logger.info("Inbound email ignored", {
      emailId,
      kind: classification.kind,
      reason: classification.reason,
    });
    return { outcome: "ignored", kind: classification.kind, reason: classification.reason };
  }
  if (!sender) {
    return { outcome: "ignored", reason: "unparseable_sender" };
  }

  const recipients = [
    ...parseAddressList(email.to).map((address) => address.address),
    ...parseAddressList(email.cc).map((address) => address.address),
    ...stringList(email.received_for).map((address) => address.toLowerCase()),
  ];
  const tokenConversationId = conversationIdFromRecipients(recipients, settings.alias);

  const inReplyTo = parseMessageIds(headerValue(headers, "in-reply-to"))[0];
  const references = parseMessageIds(headerValue(headers, "references"));
  const rootId = threadRootId({ messageId, inReplyTo, references });

  const merchantDomain = settings.supportAddress
    ? splitAddress(settings.supportAddress).domain
    : null;
  let hold = classification.hold;
  let holdReason = classification.reason;
  if (!hold && tokenConversationId) {
    if (await detectOutOfBandReply(tokenConversationId, inReplyTo, merchantDomain, ctx)) {
      hold = true;
      holdReason = "out-of-band-reply";
    }
  }

  const attachments = await uploadAttachments(email, ctx);
  const content = extractReply(text).slice(0, MAX_CONTENT_CHARS);
  if (!content && attachments.length === 0) {
    return { outcome: "ignored", reason: "empty_body" };
  }

  const result = await ctx.api.mutation<{
    messageId: string | null;
    conversationId: string;
    processed: boolean;
    deduped: boolean;
  }>("messages.receive", {
    from: sender.address,
    content,
    channel: "email",
    conversationId: tokenConversationId,
    externalConversationId: rootId,
    title: subject.slice(0, 255) || undefined,
    holdForHuman: hold || undefined,
    metadata: {
      mid: messageId,
      email: sender.address,
      profileName: sender.name,
      subject,
      messageId,
      inReplyTo,
      references,
      authentication: email.authentication ?? undefined,
      holdReason: hold ? holdReason : undefined,
    },
    attachments: attachments.length ? attachments : undefined,
  });

  ctx.state.lastInboundAt = new Date().toISOString();
  ctx.state.inboundCount += 1;

  if (result.deduped) {
    return { outcome: "deduped", conversationId: result.conversationId };
  }
  return {
    outcome: hold ? "held" : "processed",
    reason: hold ? holdReason : undefined,
    conversationId: result.conversationId,
  };
}

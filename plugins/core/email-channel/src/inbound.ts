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
import type { ReceivedAttachmentMeta, ReceivedEmail } from "./resend.js";

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
/** Matches core's conversation-media cap (CONVERSATION_MEDIA_MAX_SIZE_MB default). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_CONTENT_CHARS = 20_000;
/**
 * Inline parts below this size are signatures, logos and tracking pixels, not
 * screenshots or photos pasted into the body (D8-7).
 */
export const MIN_INLINE_IMAGE_BYTES = 20 * 1024;

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

/** An attachment the shopper sent that Hay.chat did not keep, reported in message metadata. */
export interface RejectedAttachment {
  filename: string;
  type: string;
  reason: "too_large" | "not_accepted" | "not_loaded";
}

interface AttachmentResult {
  uploaded: UploadedAttachment[];
  rejected: RejectedAttachment[];
}

/**
 * Regular attachments, plus inline images big enough to be content (a pasted
 * screenshot or photo) rather than a logo or tracking pixel.
 */
function isWanted(meta: ReceivedAttachmentMeta): boolean {
  if ((meta.content_disposition ?? "attachment") !== "inline") {
    return true;
  }
  if (!(meta.content_type ?? "").toLowerCase().startsWith("image/")) {
    return false;
  }
  return meta.size === undefined || meta.size >= MIN_INLINE_IMAGE_BYTES;
}

async function uploadAttachments(email: ReceivedEmail, ctx: ChannelContext): Promise<AttachmentResult> {
  const result: AttachmentResult = { uploaded: [], rejected: [] };
  const resend = ctx.getResend();
  if (!resend || !email.attachments?.length) {
    return result;
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
      return result;
    }
  }

  const { uploaded, rejected } = result;
  for (const meta of metas) {
    if (uploaded.length >= MAX_ATTACHMENTS) {
      break;
    }
    if (!meta.download_url || !isWanted(meta)) {
      continue;
    }
    const inline = meta.content_disposition === "inline";
    const filename = meta.filename || (inline ? "inline-image" : "attachment");
    const type = meta.content_type || "application/octet-stream";
    if (meta.size !== undefined && meta.size > MAX_ATTACHMENT_BYTES) {
      ctx.logger.warn("Skipping oversized attachment", { filename, size: meta.size });
      rejected.push({ filename, type, reason: "too_large" });
      continue;
    }
    let buffer: Buffer;
    try {
      ({ buffer } = await resend.download(meta.download_url));
    } catch (error: unknown) {
      ctx.logger.warn("Attachment download failed", {
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      rejected.push({ filename, type, reason: "not_loaded" });
      continue;
    }
    try {
      if (inline && buffer.length < MIN_INLINE_IMAGE_BYTES) {
        continue;
      }
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        ctx.logger.warn("Skipping oversized attachment", { filename, size: buffer.length });
        rejected.push({ filename, type, reason: "too_large" });
        continue;
      }
      const stored = await ctx.api.mutation<UploadedAttachment>("media.upload", {
        data: buffer.toString("base64"),
        mimeType: type,
        filename,
      });
      uploaded.push(stored);
    } catch (error: unknown) {
      // Core refuses types outside its conversation-media allow-list (HEIC,
      // archives, Office files) and content that doesn't match its type.
      ctx.logger.warn("Attachment upload failed", {
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
      rejected.push({ filename, type, reason: "not_accepted" });
    }
  }
  return result;
}

/**
 * Text the agent sees when the email has no body of its own: what was kept
 * and what was not, so an attachment-only email is never an empty turn.
 */
export function describeAttachments(
  uploaded: UploadedAttachment[],
  rejected: RejectedAttachment[],
): string {
  const lines: string[] = [];
  if (uploaded.length) {
    const images = uploaded.filter((attachment) => attachment.type.startsWith("image/")).length;
    const files = uploaded.length - images;
    const parts = [
      images ? (images === 1 ? "a photo" : `${images} photos`) : "",
      files ? (files === 1 ? "a file" : `${files} files`) : "",
    ].filter(Boolean);
    lines.push(`[Customer sent ${parts.join(" and ")}]`);
  }
  if (rejected.length) {
    lines.push(
      `[Customer sent attachments Hay.chat could not accept: ${rejected.map((item) => item.filename).join(", ")}]`,
    );
  }
  return lines.join("\n");
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

  const { uploaded: attachments, rejected } = await uploadAttachments(email, ctx);
  const body = extractReply(text).slice(0, MAX_CONTENT_CHARS);
  if (!body && attachments.length === 0 && rejected.length === 0) {
    return { outcome: "ignored", reason: "empty_body" };
  }
  const content = body || describeAttachments(attachments, rejected);
  // Only the "[Customer sent …]" line for kept files: the Inbox shows the files instead.
  const mediaPlaceholder = !body && rejected.length === 0;

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
      mediaPlaceholder: mediaPlaceholder || undefined,
      rejectedAttachments: rejected.length ? rejected : undefined,
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

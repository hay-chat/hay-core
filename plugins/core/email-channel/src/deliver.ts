import type { ChannelContext } from "./context.js";
import { normalizeMessageId, textToHtml } from "./mime.js";
import { outboundMessageId, replySubject, splitAddress, tokenAddress } from "./thread.js";

/**
 * POST /deliver — called by core's ChannelDeliveryService for every bot or
 * human-agent message on an email conversation.
 *
 * Builds a threaded reply: `In-Reply-To` the shopper's last message,
 * `References` the thread root, a Reply-To that carries the conversation id,
 * an `X-Hay-Conversation` header so a forwarded copy of our own mail is
 * recognised as an echo, and our own Message-ID so later replies thread back.
 *
 * Error semantics mirror the WhatsApp channel: a refused send → 200
 * `{success:false, error}`; Hay's own API unreachable → 503. Core marks the
 * message failed in both cases today (no delivery retry exists yet); the
 * status split keeps the two causes apart in logs.
 */

export interface DeliverResult {
  status: number;
  body: { success: boolean; providerMessageId?: string; error?: string };
}

export interface DeliverOptions {
  /** Fetch used to download attachments from Hay storage. Override for tests. */
  fetchImpl?: typeof fetch;
}

const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

interface Attachment {
  name: string;
  url: string;
  type: string;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId: string;
  conversationId: string;
  conversationMetadata: Record<string, unknown> | null;
  attachments: Attachment[];
}

interface ConversationMessage {
  type?: string;
  providerMessageId?: string | null;
  metadata?: { mid?: unknown; subject?: unknown } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePayload(payload: unknown): DeliverPayload | null {
  if (!isRecord(payload)) {
    return null;
  }
  const to = optionalString(payload.to)?.trim();
  const messageId = optionalString(payload.messageId);
  const conversationId = optionalString(payload.conversationId);
  if (!to || !messageId || !conversationId) {
    return null;
  }
  const rawAttachments = payload.attachments ?? [];
  if (!Array.isArray(rawAttachments)) {
    return null;
  }
  const attachments: Attachment[] = [];
  for (const raw of rawAttachments) {
    if (!isRecord(raw) || typeof raw.url !== "string" || !raw.url) {
      return null;
    }
    attachments.push({
      url: raw.url,
      name: optionalString(raw.name)?.trim() || "file",
      type: optionalString(raw.type) ?? "application/octet-stream",
    });
  }
  return {
    to,
    content: (optionalString(payload.content) ?? "").trim(),
    messageId,
    conversationId,
    conversationMetadata: isRecord(payload.conversationMetadata)
      ? payload.conversationMetadata
      : null,
    attachments,
  };
}

/** Threading context from the conversation's stored messages. */
export function threadingFromMessages(
  messages: ConversationMessage[],
  conversationMetadata: Record<string, unknown> | null,
): { inReplyTo?: string; references: string[]; subject?: string } {
  const customerMessages = messages.filter((message) => message.type === "Customer");
  const last = customerMessages[customerMessages.length - 1];
  const first = customerMessages[0];
  const inReplyTo = normalizeMessageId(last?.providerMessageId ?? last?.metadata?.mid);
  const emailMeta = isRecord(conversationMetadata?.email) ? conversationMetadata.email : {};
  const root = normalizeMessageId(emailMeta.conversationId);
  const references = Array.from(
    new Set([root, inReplyTo].filter((id): id is string => typeof id === "string")),
  );
  const subject = optionalString(first?.metadata?.subject) ?? optionalString(emailMeta.subject);
  return { inReplyTo, references, subject };
}

export async function deliver(
  payload: unknown,
  ctx: ChannelContext,
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const settings = ctx.getSettings();
  if (!settings) {
    return { status: 503, body: { success: false, error: "not_configured" } };
  }
  const parsed = parsePayload(payload);
  if (!parsed) {
    return { status: 400, body: { success: false, error: "invalid_payload" } };
  }
  if (!parsed.content && parsed.attachments.length === 0) {
    return { status: 200, body: { success: false, error: "empty_message" } };
  }

  let messages: ConversationMessage[] = [];
  try {
    messages = await ctx.api.query<ConversationMessage[]>("messages.getByConversation", {
      conversationId: parsed.conversationId,
    });
  } catch (error: unknown) {
    ctx.logger.error("Could not load conversation for email delivery", {
      conversationId: parsed.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 503, body: { success: false, error: "hay_api_unavailable" } };
  }

  const threading = threadingFromMessages(messages, parsed.conversationMetadata);
  const fromDomain = splitAddress(settings.fromAddress).domain;
  const ourMessageId = outboundMessageId(parsed.messageId, fromDomain);

  // RFC 3834 + the Exchange equivalent: tell the shopper's auto-responders
  // (vacation, ticketing systems) not to answer this mail and start a loop.
  const headers: Record<string, string> = {
    "X-Hay-Conversation": parsed.conversationId,
    "Auto-Submitted": "auto-replied",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
  };
  if (threading.inReplyTo) {
    headers["In-Reply-To"] = threading.inReplyTo;
  }
  if (threading.references.length) {
    headers.References = threading.references.join(" ");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const attachments: Array<{ filename: string; contentBase64: string; contentType?: string }> = [];
  let totalBytes = 0;
  for (const attachment of parsed.attachments) {
    try {
      const response = await fetchImpl(attachment.url);
      if (!response.ok) {
        throw new Error(`storage returned ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      totalBytes += buffer.length;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        ctx.logger.warn("Attachment skipped — email would exceed the size limit", {
          name: attachment.name,
        });
        totalBytes -= buffer.length;
        continue;
      }
      attachments.push({
        filename: attachment.name,
        contentBase64: buffer.toString("base64"),
        contentType: attachment.type,
      });
    } catch (error: unknown) {
      ctx.logger.warn("Attachment download failed — sending without it", {
        name: attachment.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const body = parsed.content || "(attachment)";
  const fallbackSubject = `Your conversation with ${settings.storeName}`;

  try {
    const result = await ctx.api.sendEmail({
      to: [parsed.to],
      subject: replySubject(threading.subject, fallbackSubject),
      body,
      html: textToHtml(body),
      from: { email: settings.fromAddress, name: settings.storeName },
      replyTo: tokenAddress(settings.alias, parsed.conversationId),
      bcc: settings.bccArchive && settings.supportAddress ? [settings.supportAddress] : undefined,
      headers,
      messageId: ourMessageId,
      attachments: attachments.length ? attachments : undefined,
      retry: false,
    });
    if (!result.success) {
      ctx.logger.warn("Email delivery refused", {
        conversationId: parsed.conversationId,
        error: result.error,
      });
      return { status: 200, body: { success: false, error: result.error ?? "send_failed" } };
    }
    return {
      status: 200,
      body: { success: true, providerMessageId: result.messageId ?? ourMessageId },
    };
  } catch (error: unknown) {
    ctx.logger.error("Email delivery failed — Hay API unreachable", {
      conversationId: parsed.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 503, body: { success: false, error: "hay_api_unavailable" } };
  }
}

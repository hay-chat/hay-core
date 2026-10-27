import type { ChannelContext } from "./context.js";
import type { WhatsAppConnection } from "./connection.js";
import { GraphApiError, type OutboundMediaType, type Recipient } from "./graph-client.js";
import { recipientFor } from "./identity.js";
import { DEFAULT_HANDOFF_TEMPLATE, type StoredTemplate } from "./templates.js";

/**
 * POST /deliver — called by core's ChannelDeliveryService for every bot or
 * human-agent message on a WhatsApp conversation (PLAN.md D3/D9/D12).
 *
 * Sends the text (split at 4096 chars) and each attachment (downloaded from
 * Hay storage, uploaded to Meta, sent by media id). A single image/video/
 * document carries a short text as its caption instead of a separate message.
 * Returns the first wamid so core can match later status webhooks.
 *
 * Error semantics: permanent Graph failures → 200 `{success:false, error}`;
 * rate limits and Graph outages → 503 so core retries (3 times with backoff) —
 * but only when Meta certainly did not accept anything: nothing of this reply
 * went out yet, and the failure is a structured Graph refusal or a network
 * error before the request reached Meta. A lost response (timeout, reset,
 * gateway 5xx without a Graph error) may hide an accepted message, so it is a
 * final `delivery_uncertain` instead of a retry that could send the text twice.
 *
 * Templates (D13-3, D13-4): a message whose metadata carries `channelTemplate`
 * (a person picked a template because the 24-hour window closed) is sent as
 * that template. When an AI hand-off message (`isHandoffMessage`) hits the
 * closed window (131047), the configured hand-off template goes out instead,
 * in the conversation's language when the account has it.
 */

export interface DeliverResult {
  status: number;
  body: { success: boolean; providerMessageId?: string; error?: string };
}

export interface DeliverOptions {
  /** Fetch used for attachment downloads from Hay storage. Override for tests. */
  fetchImpl?: typeof fetch;
}

const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
/** Video/audio cap on WhatsApp; images (5 MB) are refused by Meta's upload. */
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

const IMAGE_MIMES = new Set(["image/jpeg", "image/png"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/3gpp"]);
const AUDIO_MIMES = new Set(["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"]);
const CAPTION_TYPES = new Set<OutboundMediaType>(["image", "video", "document"]);

/** WhatsApp codes that mean "slow down" — retryable. */
const RATE_LIMIT_CODES = new Set([131056, 130429, 80007, 4, 131057]);

interface Attachment {
  name: string;
  url: string;
  type: string;
}

interface TemplateSend {
  name: string;
  language: string;
  parameters: Array<{ name: string; value: string }>;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId?: string;
  conversationId?: string;
  attachments: Attachment[];
  /** Conversation language (e.g. "pt"), for the hand-off template. */
  language?: string;
  channelTemplate?: TemplateSend;
  isHandoffMessage: boolean;
}

interface PreparedMedia {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  type: OutboundMediaType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseTemplateSend(value: unknown): TemplateSend | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.language !== "string") {
    return undefined;
  }
  const parameters = Array.isArray(value.parameters)
    ? value.parameters
        .filter(isRecord)
        .map((p) => ({ name: String(p.name ?? ""), value: String(p.value ?? "") }))
    : [];
  return { name: value.name, language: value.language, parameters };
}

/** Runtime shape check of core's POST body. Null when unusable. */
function parsePayload(payload: unknown): DeliverPayload | null {
  if (!isRecord(payload) || typeof payload.to !== "string" || !payload.to.trim()) {
    return null;
  }
  if (
    payload.content !== undefined &&
    payload.content !== null &&
    typeof payload.content !== "string"
  ) {
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
      type: optionalString(raw.type) ?? "",
    });
  }

  const content = (optionalString(payload.content) ?? "").trim();
  const metadata = isRecord(payload.messageMetadata) ? payload.messageMetadata : {};
  const channelTemplate = parseTemplateSend(metadata.channelTemplate);
  if (!content && attachments.length === 0 && !channelTemplate) {
    return null;
  }
  return {
    to: payload.to.trim(),
    content,
    messageId: optionalString(payload.messageId),
    conversationId: optionalString(payload.conversationId),
    attachments,
    language: optionalString(payload.language),
    channelTemplate,
    isHandoffMessage: metadata.isHandoffMessage === true,
  };
}

/**
 * Graph `components` for a template's body variables. Positional templates
 * take the values in order; named ones label each value with its name.
 */
export function templateComponents(
  parameters: TemplateSend["parameters"],
  parameterFormat: StoredTemplate["parameterFormat"],
): Array<Record<string, unknown>> | undefined {
  if (parameters.length === 0) return undefined;
  return [
    {
      type: "body",
      parameters: parameters.map((p) =>
        parameterFormat === "NAMED"
          ? { type: "text", parameter_name: p.name, text: p.value }
          : { type: "text", text: p.value },
      ),
    },
  ];
}

/** Split text into ≤limit chunks, preferring paragraph, then line, then word boundaries. */
export function splitText(text: string, limit: number = MAX_TEXT_LENGTH): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n\n");
    if (cut <= 0) cut = window.lastIndexOf("\n");
    if (cut <= 0) cut = window.lastIndexOf(" ");
    if (cut <= 0) {
      // No boundary: hard cut, without splitting a surrogate pair (emoji).
      cut = limit;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    const chunk = rest.slice(0, cut).trimEnd();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function bareMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/** WhatsApp message type for a mime; anything Meta won't play inline goes as a document. */
export function mediaTypeFor(mimeType: string): OutboundMediaType {
  if (IMAGE_MIMES.has(mimeType)) return "image";
  if (VIDEO_MIMES.has(mimeType)) return "video";
  if (AUDIO_MIMES.has(mimeType)) return "audio";
  return "document";
}

/**
 * Plain GET of a Hay storage URL. Never sends the Meta token — this is our own
 * storage, not Graph. Throws on failure or when over the size cap.
 */
async function downloadAttachment(
  attachment: Attachment,
  fetchImpl: typeof fetch,
): Promise<PreparedMedia> {
  const response = await fetchImpl(attachment.url);
  if (!response.ok) {
    throw new Error(`download failed with status ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment too large: ${declared} bytes`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`attachment too large: ${buffer.length} bytes`);
  }

  const mimeType =
    bareMime(attachment.type) ||
    bareMime(response.headers.get("content-type") ?? "") ||
    "application/octet-stream";
  return { buffer, mimeType, filename: attachment.name, type: mediaTypeFor(mimeType) };
}

interface ErrorMapping {
  status: number;
  error: string;
}

function mapGraphError(error: GraphApiError): ErrorMapping {
  if (error.code === 131047) return { status: 200, error: "24h_window_expired" };
  if (error.code !== undefined && RATE_LIMIT_CODES.has(error.code)) {
    return { status: 503, error: "rate_limited" };
  }
  if (error.status === 0) {
    return error.notSent
      ? { status: 503, error: "graph_unavailable" }
      : { status: 200, error: "delivery_uncertain" };
  }
  if (error.status >= 500) {
    // Meta answered with its own error body: it processed and refused the send.
    return error.code !== undefined
      ? { status: 503, error: "graph_unavailable" }
      : { status: 200, error: "delivery_uncertain" };
  }
  if (error.code === 190) return { status: 200, error: "token_revoked" };
  if (error.code === 133010) return { status: 200, error: "phone_not_registered" };
  if (error.code === 131026) return { status: 200, error: "recipient_unavailable" };
  return { status: 200, error: `graph_${error.code ?? error.status}` };
}

/** Token revoked or expired: Embedded Signup tokens are ours to drop; core then disconnects. */
async function revokeOnTokenError(
  error: GraphApiError,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
): Promise<void> {
  if (error.code !== 190 || connection.mode !== "embedded-signup") {
    return;
  }
  try {
    await ctx.api.mutation("connection.revoke", { reason: "graph_190" });
  } catch (revokeError: unknown) {
    ctx.logger.error("WhatsApp connection.revoke failed after Graph 190", {
      error: revokeError instanceof Error ? revokeError.message : String(revokeError),
    });
  }
}

export async function deliver(
  payload: unknown,
  ctx: ChannelContext,
  options: DeliverOptions = {},
): Promise<DeliverResult> {
  const { logger } = ctx;
  const connection = ctx.getConnection();
  if (!connection) {
    logger.error("WhatsApp deliver called but the channel is not connected");
    return { status: 503, body: { success: false, error: "Plugin not fully configured" } };
  }

  const parsed = parsePayload(payload);
  if (!parsed) {
    logger.warn("WhatsApp deliver rejected — invalid payload");
    return {
      status: 400,
      body: { success: false, error: "Missing 'to', or 'content' and 'attachments'" },
    };
  }

  const { content, attachments, messageId, conversationId } = parsed;
  const recipient: Recipient = recipientFor(parsed.to);
  const { phoneNumberId, accessToken } = connection;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logIds = { messageId, conversationId, phoneNumberId };

  if (parsed.channelTemplate) {
    return sendTemplateMessage(parsed.channelTemplate, recipient, connection, ctx, logIds);
  }

  logger.info("Delivering WhatsApp message", {
    ...logIds,
    contentLength: content.length,
    attachments: attachments.length,
  });

  // Download everything first so a broken attachment never strands a half-sent reply.
  const media: PreparedMedia[] = [];
  for (const [index, attachment] of attachments.entries()) {
    try {
      media.push(await downloadAttachment(attachment, fetchImpl));
    } catch (error: unknown) {
      logger.warn("WhatsApp attachment download failed — skipping it", {
        ...logIds,
        index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!content && media.length === 0) {
    return { status: 200, body: { success: false, error: "attachment_unavailable" } };
  }

  const captioned =
    attachments.length === 1 &&
    media.length === 1 &&
    CAPTION_TYPES.has(media[0].type) &&
    content.length > 0 &&
    content.length <= MAX_CAPTION_LENGTH;

  const sent: string[] = [];
  try {
    if (content && !captioned) {
      for (const chunk of splitText(content)) {
        sent.push(await ctx.graph.sendText(phoneNumberId, accessToken, recipient, chunk));
      }
    }
    for (const item of media) {
      const mediaId = await ctx.graph.uploadMedia(phoneNumberId, accessToken, {
        buffer: item.buffer,
        mimeType: item.mimeType,
        filename: item.filename,
      });
      sent.push(
        await ctx.graph.sendMedia(phoneNumberId, accessToken, recipient, item.type, mediaId, {
          caption: captioned ? content : undefined,
          filename: item.type === "document" ? item.filename : undefined,
        }),
      );
    }
  } catch (error: unknown) {
    const graphError = error instanceof GraphApiError ? error : null;
    if (graphError) {
      await revokeOnTokenError(graphError, connection, ctx);
    }

    if (sent.length > 0) {
      // Something already went out: a retry would duplicate it, so report success.
      logger.error("WhatsApp delivery partially failed — reporting what was sent", {
        ...logIds,
        sent: sent.length,
        status: graphError?.status,
        code: graphError?.code,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 200, body: { success: true, providerMessageId: sent[0] } };
    }

    if (!graphError) {
      logger.error("WhatsApp delivery failed", {
        ...logIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 500, body: { success: false, error: "internal_error" } };
    }

    if (graphError.code === 131047 && parsed.isHandoffMessage) {
      const fallback = await sendHandoffTemplate(parsed, recipient, connection, ctx, logIds);
      if (fallback) return fallback;
    }

    const mapped = mapGraphError(graphError);
    logger.warn("WhatsApp delivery refused by Graph", {
      ...logIds,
      status: graphError.status,
      code: graphError.code,
      subcode: graphError.subcode,
      result: mapped.error,
    });
    return { status: mapped.status, body: { success: false, error: mapped.error } };
  }

  logger.info("WhatsApp message delivered", {
    ...logIds,
    providerMessageId: sent[0],
    sent: sent.length,
    captioned,
  });
  return { status: 200, body: { success: true, providerMessageId: sent[0] } };
}

type LogIds = Record<string, string | undefined>;

async function sendTemplateMessage(
  template: TemplateSend,
  recipient: Recipient,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
  logIds: LogIds,
): Promise<DeliverResult> {
  const stored = ctx.templates?.find(template.name, template.language);
  try {
    const wamid = await ctx.graph.sendTemplate(
      connection.phoneNumberId,
      connection.accessToken,
      recipient,
      {
        name: template.name,
        languageCode: template.language,
        components: templateComponents(
          template.parameters,
          stored?.parameterFormat ?? "POSITIONAL",
        ),
      },
    );
    ctx.logger.info("WhatsApp template delivered", { ...logIds, template: template.name });
    return { status: 200, body: { success: true, providerMessageId: wamid } };
  } catch (error: unknown) {
    if (!(error instanceof GraphApiError)) {
      ctx.logger.error("WhatsApp template delivery failed", {
        ...logIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 500, body: { success: false, error: "internal_error" } };
    }
    await revokeOnTokenError(error, connection, ctx);
    const mapped = mapGraphError(error);
    ctx.logger.warn("WhatsApp template refused by Graph", {
      ...logIds,
      template: template.name,
      status: error.status,
      code: error.code,
      result: mapped.error,
    });
    return { status: mapped.status, body: { success: false, error: mapped.error } };
  }
}

/**
 * The AI handed off after the 24-hour window closed: tell the customer a
 * person will reply, with the approved hand-off template. Null when no such
 * template is approved, so the caller reports the original window error.
 */
async function sendHandoffTemplate(
  parsed: DeliverPayload,
  recipient: Recipient,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
  logIds: LogIds,
): Promise<DeliverResult | null> {
  const name = ctx.handoffTemplateName?.trim() || DEFAULT_HANDOFF_TEMPLATE;
  const template = ctx.templates?.pickLanguage(name, parsed.language);
  if (!template || template.variables.length > 0) {
    ctx.logger.warn("WhatsApp hand-off outside the window — no sendable hand-off template", {
      ...logIds,
      template: name,
    });
    return null;
  }
  ctx.logger.info("WhatsApp hand-off outside the window — sending the hand-off template", {
    ...logIds,
    template: name,
    language: template.language,
  });
  return sendTemplateMessage(
    { name: template.name, language: template.language, parameters: [] },
    recipient,
    connection,
    ctx,
    logIds,
  );
}

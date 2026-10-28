import type { ChannelContext } from "./context.js";
import type { WhatsAppConnection } from "./connection.js";
import { customerExternalId } from "./identity.js";
import { describeMedia, ingestMedia, type Attachment, type InboundMedia, type InboundMediaType } from "./media.js";

/**
 * Inbound WhatsApp webhook normaliser.
 *
 * Meta delivers `{ object: "whatsapp_business_account", entry: [{ id: <WABA>,
 * changes: [{ field, value }] }] }`. By the time we run, index.ts has checked
 * the payload is trusted (core-verified on the shared URL, or signed with the
 * org's own app secret in manual mode) and that the channel is connected.
 *
 *  - `messages` changes carry inbound messages (→ `messages.receive`) and
 *    delivery statuses of our outbound messages (→ `messages.updateStatus`).
 *  - `account_update` carries revocation (PARTNER_APP_UNINSTALLED & co.)
 *    (→ `connection.revoke`, Embedded Signup only).
 *  - `message_template_status_update` / `template_category_update` patch the
 *    worker's template store (D13-1).
 *  - `smb_message_echoes` (coexistence) carries what the owner typed in the
 *    WhatsApp Business app on the phone (→ `messages.receive` as a
 *    `human_agent` message, so the AI stops answering over the owner; D13-8).
 *  - Everything else is logged and ignored for now.
 *
 * A failing `messages.receive` throws so index.ts answers 500 and Meta retries;
 * core dedupes inbound on `metadata.mid` (the wamid), so retries are safe.
 */

export interface WebhookSummary {
  processed: number;
  ignored: number;
  statuses: number;
}

type JsonObject = Record<string, unknown>;

interface WaContact {
  profile?: { name?: string };
  wa_id?: string;
  user_id?: string;
}

interface WaError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

interface WaMessage {
  from?: string;
  from_user_id?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    nfm_reply?: { name?: string; body?: string; response_json?: string };
  };
  button?: { payload?: string; text?: string };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
    url?: string;
  };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  order?: {
    catalog_id?: string;
    text?: string;
    product_items?: Array<{
      product_retailer_id?: string;
      quantity?: number;
      item_price?: number;
      currency?: string;
    }>;
  };
  system?: { type?: string };
  unsupported?: { type?: string };
  errors?: WaError[];
  context?: { from?: string; id?: string; forwarded?: boolean; frequently_forwarded?: boolean };
  referral?: JsonObject;
  image?: InboundMedia;
  video?: InboundMedia;
  audio?: InboundMedia;
  document?: InboundMedia;
  sticker?: InboundMedia;
}

interface WaStatus {
  id?: string;
  status?: string;
  errors?: WaError[];
}

/** Coexistence: a message the business sent from the WhatsApp Business app. */
interface WaEcho extends WaMessage {
  /** The customer's wa_id (`from` is the business number). */
  to?: string;
  to_user_id?: string;
}

interface WaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: WaContact[];
  messages?: WaMessage[];
  /** smb_message_echoes */
  message_echoes?: WaEcho[];
  statuses?: WaStatus[];
  errors?: WaError[];
  /** account_update */
  event?: string;
}

interface WaChange {
  field?: string;
  value?: WaValue;
}

interface WaEntry {
  id?: string;
  changes?: WaChange[];
}

const STATUS_MAP: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  // Voice note listened to — the strongest "read" signal there is.
  played: "read",
  failed: "failed",
};

/** account_update events that mean Hay lost access to the number. */
const REVOKE_EVENTS = new Set(["PARTNER_APP_UNINSTALLED", "PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"]);
const WARN_EVENTS = new Set(["ACCOUNT_VIOLATION", "ACCOUNT_RESTRICTION", "DISABLED_UPDATE"]);

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Drop undefined keys so metadata stays readable in the customer record. */
function compact(values: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

/** Placeholder content so the agent can still acknowledge media it cannot see. */
function unloadedMedia(type: InboundMediaType): string {
  const article = /^[aeiou]/.test(type) ? "an" : "a";
  return `[Customer sent ${article} ${type} that could not be loaded]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleWebhook(body: unknown, ctx: ChannelContext): Promise<WebhookSummary> {
  const connection = ctx.getConnection();
  if (!connection) {
    throw new Error("WhatsApp channel is not connected");
  }

  const summary: WebhookSummary = { processed: 0, ignored: 0, statuses: 0 };
  const entries = asArray<WaEntry>(
    body && typeof body === "object" ? (body as JsonObject).entry : undefined,
  );
  let revoked = false;

  for (const entry of entries) {
    for (const change of asArray<WaChange>(entry?.changes)) {
      const value = change?.value ?? {};

      // Defense in depth: core routes by phone_number_id, but never act on
      // another number's events if one slips through.
      const phoneNumberId = value.metadata?.phone_number_id;
      if (phoneNumberId && phoneNumberId !== connection.phoneNumberId) {
        ctx.logger.warn("WhatsApp change ignored — addressed to another phone number", {
          field: change.field,
          phoneNumberId,
        });
        summary.ignored++;
        continue;
      }

      if (change.field === "messages") {
        await handleMessagesChange(value, connection, ctx, summary);
      } else if (change.field === "account_update") {
        if (await handleAccountUpdate(value, connection, ctx, revoked)) {
          revoked = true;
        } else {
          summary.ignored++;
        }
      } else if (TEMPLATE_FIELDS.has(change.field ?? "")) {
        handleTemplateChange(change.field ?? "", value, entry.id, connection, ctx);
      } else if (change.field === "smb_message_echoes") {
        for (const echo of asArray<WaEcho>(value.message_echoes)) {
          if (await receiveEcho(echo, value, connection, ctx)) {
            summary.processed++;
          } else {
            summary.ignored++;
          }
        }
      } else {
        // TODO: Phase 3 — phone_number_quality_update for the health card.
        // TODO: Phase 4 — coexistence `history` import.
        ctx.logger.info("WhatsApp webhook field ignored", {
          field: change.field,
          wabaId: entry.id,
        });
        summary.ignored++;
      }
    }
  }

  return summary;
}

const TEMPLATE_FIELDS = new Set(["message_template_status_update", "template_category_update"]);

/** Patch the template store; an unknown template triggers a background resync. */
function handleTemplateChange(
  field: string,
  value: WaValue,
  wabaId: string | undefined,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
): void {
  if (wabaId && wabaId !== connection.wabaId) {
    ctx.logger.warn("WhatsApp template event ignored — another Messaging account", { wabaId });
    return;
  }
  const store = ctx.templates;
  if (!store) return;
  const data = value as unknown as JsonObject;
  const applied =
    field === "template_category_update"
      ? store.applyCategoryUpdate(data)
      : store.applyStatusUpdate(data);
  ctx.logger.info("WhatsApp template event", {
    field,
    name: data.message_template_name,
    event: data.event ?? data.new_category,
    applied,
  });
  if (!applied) {
    void store.sync(connection);
  }
}

/** WhatsApp's customer service window: 24 hours from the customer's last message. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function replyWindowExpiresAt(timestamp: string | undefined): string {
  const seconds = Number(timestamp);
  const sentAt = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
  return new Date(sentAt + REPLY_WINDOW_MS).toISOString();
}

async function handleMessagesChange(
  value: WaValue,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
  summary: WebhookSummary,
): Promise<void> {
  const contacts = asArray<WaContact>(value.contacts);

  // Sequential, in payload order, so the conversation reads as the customer typed it.
  for (const message of asArray<WaMessage>(value.messages)) {
    if (await receiveMessage(message, contacts, value, connection, ctx)) {
      summary.processed++;
    } else {
      summary.ignored++;
    }
  }

  for (const status of asArray<WaStatus>(value.statuses)) {
    if (await updateStatus(status, ctx)) {
      summary.statuses++;
    } else {
      summary.ignored++;
    }
  }

  for (const error of asArray<WaError>(value.errors)) {
    ctx.logger.warn("WhatsApp webhook reported an error", { code: error.code, title: error.title });
  }
}

function findContact(message: WaMessage, contacts: WaContact[]): WaContact | undefined {
  return (
    contacts.find((contact) => message.from && contact.wa_id === message.from) ??
    contacts.find((contact) => message.from_user_id && contact.user_id === message.from_user_id) ??
    contacts[0]
  );
}

/** What a message type turns into: text for the agent plus type-specific metadata. */
interface Normalised {
  content: string;
  metadata?: JsonObject;
  media?: { type: InboundMediaType; media: InboundMedia };
}

/** Returns null when the message type is not something the agent should answer. */
function normalise(message: WaMessage, ctx: ChannelContext): Normalised | null {
  const type = message.type;

  switch (type) {
    case "text":
      return { content: message.text?.body ?? "" };

    case "interactive": {
      const interactive = message.interactive;
      const reply = interactive?.button_reply ?? interactive?.list_reply;
      if (reply) {
        return {
          content: reply.title ?? "",
          metadata: {
            interactive: compact({
              type: interactive?.type,
              id: reply.id,
              title: reply.title,
              description: interactive?.list_reply?.description,
            }),
          },
        };
      }
      const form = interactive?.nfm_reply;
      if (form) {
        return {
          content: form.body || "Form submitted",
          metadata: {
            interactive: compact({
              type: interactive?.type,
              name: form.name,
              responseJson: form.response_json,
            }),
          },
        };
      }
      ctx.logger.info("WhatsApp interactive reply ignored — unknown type", {
        interactiveType: interactive?.type,
      });
      return null;
    }

    case "button":
      return {
        content: message.button?.text ?? "",
        metadata: {
          button: compact({ payload: message.button?.payload, text: message.button?.text }),
        },
      };

    case "location":
      return {
        content: describeLocation(message.location ?? {}),
        metadata: { location: message.location },
      };

    case "contacts":
      return {
        content: asArray<NonNullable<WaMessage["contacts"]>[number]>(message.contacts)
          .map((card) =>
            `Shared contact: ${card.name?.formatted_name ?? ""} ${card.phones?.[0]?.phone ?? ""}`.trim(),
          )
          .join("\n"),
        metadata: { contacts: message.contacts },
      };

    case "order":
      return { content: describeOrder(message.order ?? {}), metadata: { order: message.order } };

    case "request_welcome":
      // The customer opened the chat from an ad / CTA without typing — a greeting.
      return { content: "Hello" };

    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const media = message[type];
      if (!media?.id) {
        return { content: media?.caption || unloadedMedia(type) };
      }
      return { content: media.caption ?? "", media: { type, media } };
    }

    case "reaction":
      // Deliberate: the agent must not reply to emoji reactions.
      ctx.logger.info("WhatsApp reaction ignored", { mid: message.id });
      return null;

    case "system":
      // TODO: re-key the customer on user_changed_number / user_changed_user_id (BSUID).
      ctx.logger.info("WhatsApp system message ignored", {
        systemType: message.system?.type,
        mid: message.id,
      });
      return null;

    case "unsupported":
      ctx.logger.info("WhatsApp unsupported message ignored", {
        code: message.errors?.[0]?.code,
        unsupportedType: message.unsupported?.type,
        mid: message.id,
      });
      return null;

    default:
      ctx.logger.info("WhatsApp message ignored — unknown type", { type, mid: message.id });
      return null;
  }
}

function describeLocation(location: NonNullable<WaMessage["location"]>): string {
  const label = [location.name, location.address].filter(Boolean).join(" — ");
  const { latitude, longitude } = location;
  const hasCoords = typeof latitude === "number" && typeof longitude === "number";
  const parts = [
    label,
    hasCoords ? `(${latitude}, ${longitude})` : "",
    hasCoords ? `https://maps.google.com/?q=${latitude},${longitude}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `Location: ${parts.join(" ")}` : "";
}

function describeOrder(order: NonNullable<WaMessage["order"]>): string {
  const items = order.product_items ?? [];
  const count = items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
  const skus = items.map((item) => item.product_retailer_id).filter(Boolean);
  let text = `Order: ${count} item${count === 1 ? "" : "s"}`;
  if (skus.length > 0) {
    text += ` (${skus.join(", ")})`;
  }

  // Only total when every line is priced in the same currency.
  const currencies = new Set(items.map((item) => item.currency));
  const priced = items.length > 0 && items.every((item) => typeof item.item_price === "number");
  if (priced && currencies.size === 1) {
    const total = items.reduce(
      (sum, item) => sum + (item.item_price ?? 0) * (item.quantity ?? 1),
      0,
    );
    text += ` — total ${Math.round(total * 100) / 100} ${[...currencies][0] ?? ""}`.trimEnd();
  }
  if (order.text) {
    text += `\n${order.text}`;
  }
  return text;
}

/** Normalised content plus the stored media, transcript or placeholder line. */
async function resolveMedia(
  normalised: Normalised,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
): Promise<{ content: string; extra: JsonObject; attachments?: Attachment[] }> {
  let content = normalised.content;
  const extra: JsonObject = { ...normalised.metadata };
  let attachments: Attachment[] | undefined;

  if (normalised.media) {
    const { type, media } = normalised.media;
    const result = await ingestMedia({ type, media, connection, ctx });
    if (result.attachment) {
      attachments = [result.attachment];
      if (type === "audio" && result.transcript) {
        content = result.transcript;
        extra.voiceNote = true;
      } else if (!content.trim()) {
        // Never an empty turn: the agent learns what arrived; the Inbox shows
        // the media itself instead of this line.
        content = describeMedia(type, media);
        extra.mediaPlaceholder = true;
      }
    } else if (!content) {
      // Let the agent still acknowledge something arrived.
      content = unloadedMedia(type);
    }
  }
  return { content, extra, attachments };
}

/**
 * Coexistence echo (D13-8): the owner answered from the WhatsApp Business app.
 * Stored as a `human_agent` message on the customer's conversation, which core
 * treats like a take-over, so the AI does not answer over the owner. Meta sends
 * echoes only for messages typed in the app, never for Hay.chat's own API sends;
 * core also skips any echo whose wamid matches a message Hay.chat sent.
 */
async function receiveEcho(
  echo: WaEcho,
  value: WaValue,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
): Promise<boolean> {
  const from = customerExternalId(echo.to, echo.to_user_id);
  if (!from) {
    ctx.logger.warn("WhatsApp echo ignored — no customer id", { mid: echo.id });
    return false;
  }

  const normalised = normalise(echo, ctx);
  if (!normalised) {
    return false;
  }
  const { content, extra, attachments } = await resolveMedia(normalised, connection, ctx);
  if (!content.trim() && !attachments) {
    ctx.logger.info("WhatsApp echo ignored — no content", { mid: echo.id, type: echo.type });
    return false;
  }

  const digits = echo.to?.replace(/\D/g, "");
  const metadata = compact({
    mid: echo.id,
    phone: digits ? `+${digits}` : undefined,
    waId: echo.to,
    userId: echo.to_user_id,
    phoneNumberId: value.metadata?.phone_number_id ?? connection.phoneNumberId,
    timestamp: echo.timestamp,
    type: echo.type,
    echo: true,
    source: "whatsapp_business_app",
    ...extra,
  });

  const result = await ctx.api.mutation<{ messageId?: string; conversationId?: string }>(
    "messages.receive",
    {
      from,
      content,
      channel: "whatsapp",
      senderType: "human_agent",
      metadata,
      ...(attachments ? { attachments } : {}),
    },
  );

  ctx.logger.info("WhatsApp Business app reply stored as a human message", {
    mid: echo.id,
    type: echo.type,
    messageId: result?.messageId,
    conversationId: result?.conversationId,
  });
  return true;
}

/** Forward one inbound message to core. Returns false when ignored. */
async function receiveMessage(
  message: WaMessage,
  contacts: WaContact[],
  value: WaValue,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
): Promise<boolean> {
  const contact = findContact(message, contacts);
  const waId = message.from ?? contact?.wa_id;
  const userId = message.from_user_id ?? contact?.user_id;
  const from = customerExternalId(waId, userId);
  if (!from) {
    ctx.logger.warn("WhatsApp message ignored — sender has neither wa_id nor user_id", {
      mid: message.id,
    });
    return false;
  }

  const normalised = normalise(message, ctx);
  if (!normalised) {
    return false;
  }

  const { content, extra, attachments } = await resolveMedia(normalised, connection, ctx);

  if (!content.trim() && !attachments) {
    ctx.logger.info("WhatsApp message ignored — no content", {
      mid: message.id,
      type: message.type,
    });
    return false;
  }

  const digits = waId?.replace(/\D/g, "");
  const metadata = compact({
    mid: message.id,
    profileName: contact?.profile?.name,
    phone: digits ? `+${digits}` : undefined,
    waId,
    userId,
    phoneNumberId: value.metadata?.phone_number_id ?? connection.phoneNumberId,
    timestamp: message.timestamp,
    type: message.type,
    context: message.context
      ? compact({
          replyTo: message.context.id,
          forwarded: message.context.forwarded,
          frequentlyForwarded: message.context.frequently_forwarded,
        })
      : undefined,
    referral: message.referral,
    ...extra,
  });

  const result = await ctx.api.mutation<{ messageId?: string; conversationId?: string }>(
    "messages.receive",
    {
      from,
      content,
      channel: "whatsapp",
      senderType: "customer",
      metadata,
      replyWindowExpiresAt: replyWindowExpiresAt(message.timestamp),
      ...(attachments ? { attachments } : {}),
    },
  );

  ctx.logger.info("WhatsApp message forwarded to Hay orchestrator", {
    mid: message.id,
    type: message.type,
    messageId: result?.messageId,
    conversationId: result?.conversationId,
  });
  return true;
}

/** Best effort: a failed status update is logged, never retried by Meta. */
async function updateStatus(status: WaStatus, ctx: ChannelContext): Promise<boolean> {
  const mapped = status.status ? STATUS_MAP[status.status] : undefined;
  if (!status.id || !mapped) {
    ctx.logger.info("WhatsApp status ignored", { status: status.status, id: status.id });
    return false;
  }

  const first = status.errors?.[0];
  const error =
    mapped === "failed" && first
      ? compact({
          code: first.code,
          title: first.title,
          message: first.error_data?.details ?? first.message,
        })
      : undefined;

  try {
    await ctx.api.mutation("messages.updateStatus", {
      providerMessageId: status.id,
      status: mapped,
      ...(error ? { error } : {}),
    });
  } catch (err: unknown) {
    ctx.logger.warn("WhatsApp status update failed", {
      id: status.id,
      status: mapped,
      error: errorMessage(err),
    });
  }
  return true;
}

/** Returns true when it reported the connection revoked. */
async function handleAccountUpdate(
  value: WaValue,
  connection: WhatsAppConnection,
  ctx: ChannelContext,
  alreadyRevoked: boolean,
): Promise<boolean> {
  const event = value.event ?? "unknown";

  if (REVOKE_EVENTS.has(event) && connection.mode === "embedded-signup") {
    if (alreadyRevoked) {
      return true;
    }
    ctx.logger.warn("WhatsApp access removed by the business — revoking connection", { event });
    try {
      await ctx.api.mutation("connection.revoke", { reason: `account_update:${event}` });
    } catch (error: unknown) {
      ctx.logger.error("WhatsApp connection revoke failed", { event, error: errorMessage(error) });
    }
    return true;
  }

  if (WARN_EVENTS.has(event)) {
    ctx.logger.warn("WhatsApp account update", { event });
  } else {
    ctx.logger.info("WhatsApp account update", { event, mode: connection.mode });
  }
  return false;
}

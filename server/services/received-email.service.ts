import { createLogger } from "@server/lib/logger";
import { normalizeEmailAddressKey } from "@server/lib/svix-signature";
import { pluginWebhookRouteRepository } from "@server/repositories/plugin-webhook-route.repository";

const logger = createLogger("received-email");

const RESEND_API_BASE = "https://api.resend.com";
/** Budget for one Resend API call. */
const RESEND_TIMEOUT_MS = 15_000;

export type ReceivedEmailErrorKind =
  | "not_found"
  /** Rate limit, server error, timeout or network failure: worth retrying. */
  | "unavailable"
  | "provider_error"
  | "not_configured";

export class ReceivedEmailError extends Error {
  constructor(
    message: string,
    readonly kind: ReceivedEmailErrorKind,
  ) {
    super(message);
    this.name = "ReceivedEmailError";
  }
}

export interface ReceivedAttachment {
  id: string;
  filename: string;
  content_type: string;
  content_disposition?: string;
  content_id?: string;
  size?: number;
  download_url?: string;
  expires_at?: string;
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject?: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, unknown>;
  message_id?: string;
  received_for?: string[];
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  raw?: { download_url: string; expires_at?: string } | null;
  attachments?: ReceivedAttachment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toAttachment(raw: unknown): ReceivedAttachment | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    filename: optionalString(raw.filename) ?? "",
    content_type: optionalString(raw.content_type) ?? "",
    content_disposition: optionalString(raw.content_disposition),
    content_id: optionalString(raw.content_id),
    size: optionalNumber(raw.size),
    download_url: optionalString(raw.download_url),
    expires_at: optionalString(raw.expires_at),
  };
}

function toAttachments(raw: unknown): ReceivedAttachment[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.data) ? raw.data : [];
  return list.map(toAttachment).filter((entry): entry is ReceivedAttachment => entry !== null);
}

/** Keeps only the fields channel plugins use; the rest of Resend's response is dropped. */
function toEmail(raw: unknown): ReceivedEmail {
  if (!isRecord(raw) || typeof raw.id !== "string") {
    throw new ReceivedEmailError("Unexpected Resend response", "provider_error");
  }
  const authentication = isRecord(raw.authentication)
    ? {
        spf: optionalString(raw.authentication.spf),
        dkim: optionalString(raw.authentication.dkim),
        dmarc: optionalString(raw.authentication.dmarc),
      }
    : null;
  const rawMessage =
    isRecord(raw.raw) && typeof raw.raw.download_url === "string"
      ? { download_url: raw.raw.download_url, expires_at: optionalString(raw.raw.expires_at) }
      : null;
  return {
    id: raw.id,
    from: optionalString(raw.from) ?? "",
    to: stringList(raw.to),
    cc: stringList(raw.cc),
    subject: optionalString(raw.subject),
    text: optionalString(raw.text) ?? null,
    html: optionalString(raw.html) ?? null,
    headers: isRecord(raw.headers) ? raw.headers : undefined,
    message_id: optionalString(raw.message_id),
    received_for: stringList(raw.received_for),
    authentication,
    raw: rawMessage,
    attachments: Array.isArray(raw.attachments) ? toAttachments(raw.attachments) : undefined,
  };
}

async function resendGet(path: string): Promise<unknown> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new ReceivedEmailError("Receiving email is not available", "not_configured");
  }
  let response: Response;
  try {
    response = await fetch(`${RESEND_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ path, err: error }, "Resend receiving call did not complete");
    throw new ReceivedEmailError("Resend is unreachable", "unavailable");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.warn({ path, status: response.status, body: body.slice(0, 500) }, "Resend call failed");
    if (response.status === 404) {
      throw new ReceivedEmailError("Email not found", "not_found");
    }
    const transient = response.status === 429 || response.status >= 500;
    throw new ReceivedEmailError(
      `Resend returned ${response.status}`,
      transient ? "unavailable" : "provider_error",
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ReceivedEmailError("Unexpected Resend response", "provider_error");
  }
}

/**
 * True when the email names a routing key that `organizationId` holds for
 * `pluginId`, the same keys that route the inbound webhook. Both recipient
 * lists count, because forwarded mail can carry the routing key in either.
 */
async function addressedToOrganization(
  email: ReceivedEmail,
  pluginId: string,
  organizationId: string,
): Promise<boolean> {
  const keys = new Set(
    [...email.to, ...(email.received_for ?? [])]
      .map((address) => normalizeEmailAddressKey(address))
      .filter((key): key is string => key !== undefined),
  );
  for (const key of keys) {
    const route = await pluginWebhookRouteRepository.findByKey(pluginId, key);
    if (route?.organizationId === organizationId) return true;
  }
  return false;
}

export const receivedEmailService = {
  /**
   * The received email, only for the organization it was addressed to. An id
   * that belongs to another organization is reported exactly like an unknown one.
   */
  async get(emailId: string, pluginId: string, organizationId: string): Promise<ReceivedEmail> {
    const email = toEmail(await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}`));
    if (!(await addressedToOrganization(email, pluginId, organizationId))) {
      logger.warn(
        { pluginId, organizationId },
        "Received email requested outside its organization",
      );
      throw new ReceivedEmailError("Email not found", "not_found");
    }
    return email;
  },

  async listAttachments(
    emailId: string,
    pluginId: string,
    organizationId: string,
  ): Promise<ReceivedAttachment[]> {
    await this.get(emailId, pluginId, organizationId);
    return toAttachments(
      await resendGet(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`),
    );
  },
};

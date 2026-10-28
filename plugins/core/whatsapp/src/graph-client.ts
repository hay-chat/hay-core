import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * WhatsApp Cloud API client (Graph API v26.0 on graph.facebook.com).
 *
 * Thin native-fetch wrapper around the endpoints the channel needs. Every call
 * authenticates with the tenant's business token (Embedded Signup) or pasted
 * system-user token (manual mode) as a Bearer header, and every failure throws
 * a typed `GraphApiError` carrying the HTTP status plus Meta's structured error
 * (`code`, `error_subcode`, `error_data.details`) so callers can branch on the
 * WhatsApp error codes (131047 window closed, 131056 pair rate limit, 190 token
 * revoked, …) without re-parsing bodies.
 */

export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Inbound media can be up to 100 MB (documents); Hay storage caps far lower. */
const DEFAULT_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export class GraphApiError extends Error {
  public readonly status: number;
  public readonly code?: number;
  public readonly subcode?: number;
  /** `error.error_data.details` — WhatsApp's human-readable cause. */
  public readonly details?: string;
  /**
   * Network failure (status 0) before the request reached Meta (DNS, refused,
   * connect timeout), so Meta certainly did not accept it. False for failures
   * that may have happened after Meta received the request.
   */
  public readonly notSent: boolean;

  constructor(
    message: string,
    status: number,
    code?: number,
    subcode?: number,
    details?: string,
    notSent = false,
  ) {
    super(message);
    this.name = "GraphApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.details = details;
    this.notSent = notSent;
  }
}

/** Node fetch failures that happen before any byte of the request reaches the server. */
const CONNECT_PHASE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function isConnectPhaseError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" && CONNECT_PHASE_CODES.has(cause.code);
}

/**
 * Who a message goes to. `to` is a phone number in E.164 with `+` (without the
 * `+` Meta prepends the business's own country code); `recipient` is a
 * business-scoped user id (BSUID) for users who hide their number behind a
 * WhatsApp username.
 */
export type Recipient = { to: string } | { recipient: string };

export type OutboundMediaType = "image" | "video" | "audio" | "document" | "sticker";

export interface MediaInfo {
  url: string;
  mime_type: string;
  sha256?: string;
  file_size?: number;
  id: string;
}

export interface PhoneNumberInfo {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  quality_rating?: string;
  status?: string;
  platform_type?: string;
  is_on_biz_app?: boolean;
  account_mode?: string;
  whatsapp_business_manager_messaging_limit?: string;
  health_status?: {
    can_send_message?: string;
    entities?: Array<{
      entity_type?: string;
      id?: string;
      can_send_message?: string;
      errors?: Array<{
        error_code?: number;
        error_description?: string;
        possible_solution?: string;
      }>;
    }>;
  };
}

export interface WabaInfo {
  id: string;
  name?: string;
  primary_funding_id?: string;
  owner_business_info?: { id?: string; name?: string };
}

type JsonObject = Record<string, unknown>;

/** A message template as `GET /{waba}/message_templates` returns it. */
export interface GraphTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  parameter_format?: "POSITIONAL" | "NAMED";
  rejected_reason?: string;
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string }>;
  }>;
}

/** Body of `POST /{waba}/message_templates`. */
export interface NewTemplate {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  components: JsonObject[];
}

const TEMPLATE_FIELDS =
  "id,name,language,status,category,parameter_format,rejected_reason,components";
/** Stop paging after this many pages (100 each) — a WABA holds at most a few hundred. */
const MAX_TEMPLATE_PAGES = 20;

interface RequestOptions {
  query?: Record<string, string>;
  body?: JsonObject;
  form?: FormData;
}

export interface GraphClientOptions {
  logger: HayLogger;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

export class GraphClient {
  private readonly logger: HayLogger;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GraphClientOptions) {
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Single request helper: Bearer auth, JSON or multipart body, JSON response,
   * `GraphApiError` on any non-2xx (status 0 = network failure, retryable).
   */
  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    accessToken: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(`${GRAPH_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    let body: string | FormData | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { method, headers, body });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "unknown";
      throw new GraphApiError(
        `Graph API network error: ${reason}`,
        0,
        undefined,
        undefined,
        undefined,
        isConnectPhaseError(error),
      );
    }

    const text = await response.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!response.ok) {
      throw this.toError(method, path, response.status, parsed);
    }

    return parsed as T;
  }

  private toError(method: string, path: string, status: number, parsed: unknown): GraphApiError {
    const metaError =
      parsed && typeof parsed === "object" && "error" in parsed
        ? ((parsed as { error?: JsonObject }).error ?? {})
        : {};
    const message =
      typeof metaError.message === "string"
        ? metaError.message
        : `Graph API request failed with status ${status}`;
    const code = typeof metaError.code === "number" ? metaError.code : undefined;
    const subcode =
      typeof metaError.error_subcode === "number" ? metaError.error_subcode : undefined;
    const errorData = metaError.error_data as JsonObject | undefined;
    const details = typeof errorData?.details === "string" ? errorData.details : undefined;

    this.logger.warn("Graph API request failed", { method, path, status, code, subcode, message });
    return new GraphApiError(message, status, code, subcode, details);
  }

  /**
   * POST /{phone-number-id}/messages with any message body. Returns the wamid.
   * `200 OK` means Meta accepted the message, not that it was delivered.
   */
  async sendMessage(
    phoneNumberId: string,
    accessToken: string,
    recipient: Recipient,
    message: JsonObject,
  ): Promise<string> {
    const data = await this.request<{ messages?: Array<{ id?: string }> }>(
      "POST",
      `/${encodeURIComponent(phoneNumberId)}/messages`,
      accessToken,
      {
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          ...recipient,
          ...message,
        },
      },
    );

    const messageId = data?.messages?.[0]?.id;
    if (!messageId) {
      throw new GraphApiError("Graph API send returned no message id", 502);
    }
    return messageId;
  }

  /** Free-form text (≤4096 chars); only inside the 24h customer service window. */
  sendText(phoneNumberId: string, accessToken: string, recipient: Recipient, text: string) {
    return this.sendMessage(phoneNumberId, accessToken, recipient, {
      type: "text",
      text: { body: text, preview_url: true },
    });
  }

  /** Media previously uploaded with `uploadMedia`. `caption` is ignored for audio/sticker. */
  sendMedia(
    phoneNumberId: string,
    accessToken: string,
    recipient: Recipient,
    type: OutboundMediaType,
    mediaId: string,
    options: { caption?: string; filename?: string } = {},
  ) {
    const media: JsonObject = { id: mediaId };
    if (options.caption && type !== "audio" && type !== "sticker") {
      media.caption = options.caption;
    }
    if (options.filename && type === "document") {
      media.filename = options.filename;
    }
    return this.sendMessage(phoneNumberId, accessToken, recipient, { type, [type]: media });
  }

  /**
   * Approved template message — the only thing allowed outside the 24h window.
   * Sent by the human template picker and the hand-off fallback (D13-3/4).
   */
  sendTemplate(
    phoneNumberId: string,
    accessToken: string,
    recipient: Recipient,
    template: { name: string; languageCode: string; components?: JsonObject[] },
  ) {
    return this.sendMessage(phoneNumberId, accessToken, recipient, {
      type: "template",
      template: {
        name: template.name,
        language: { code: template.languageCode },
        ...(template.components ? { components: template.components } : {}),
      },
    });
  }

  /**
   * Mark an inbound message read and show "typing…" until the next send or 25 s.
   * Only call when a reply is actually coming.
   */
  async markReadTyping(
    phoneNumberId: string,
    accessToken: string,
    messageId: string,
  ): Promise<void> {
    await this.request("POST", `/${encodeURIComponent(phoneNumberId)}/messages`, accessToken, {
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      },
    });
  }

  /** Subscribe this app to the Messaging account's webhooks. Idempotent. */
  async subscribeApp(wabaId: string, accessToken: string): Promise<void> {
    await this.request("POST", `/${encodeURIComponent(wabaId)}/subscribed_apps`, accessToken);
  }

  /** Register the number for Cloud API with a 6-digit two-step PIN (not for coexistence numbers). */
  async registerPhone(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
    await this.request("POST", `/${encodeURIComponent(phoneNumberId)}/register`, accessToken, {
      body: { messaging_product: "whatsapp", pin },
    });
  }

  /** Set (or reset) the number's two-step verification PIN. */
  async setTwoStepPin(phoneNumberId: string, accessToken: string, pin: string): Promise<void> {
    await this.request("POST", `/${encodeURIComponent(phoneNumberId)}`, accessToken, {
      body: { pin },
    });
  }

  getPhone(phoneNumberId: string, accessToken: string, fields: string[]): Promise<PhoneNumberInfo> {
    return this.request<PhoneNumberInfo>(
      "GET",
      `/${encodeURIComponent(phoneNumberId)}`,
      accessToken,
      { query: { fields: fields.join(",") } },
    );
  }

  getWaba(wabaId: string, accessToken: string, fields: string[]): Promise<WabaInfo> {
    return this.request<WabaInfo>("GET", `/${encodeURIComponent(wabaId)}`, accessToken, {
      query: { fields: fields.join(",") },
    });
  }

  /** Numbers on a Messaging account the token can see. */
  async listPhoneNumbers(wabaId: string, accessToken: string): Promise<PhoneNumberInfo[]> {
    const data = await this.request<{ data?: PhoneNumberInfo[] }>(
      "GET",
      `/${encodeURIComponent(wabaId)}/phone_numbers`,
      accessToken,
      { query: { fields: "id,display_phone_number,verified_name" } },
    );
    return Array.isArray(data?.data) ? data.data : [];
  }

  /** Every message template on the Messaging account (all statuses), following paging. */
  async listTemplates(wabaId: string, accessToken: string): Promise<GraphTemplate[]> {
    const templates: GraphTemplate[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
      const data = await this.request<{
        data?: GraphTemplate[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>("GET", `/${encodeURIComponent(wabaId)}/message_templates`, accessToken, {
        query: { fields: TEMPLATE_FIELDS, limit: "100", ...(after ? { after } : {}) },
      });
      templates.push(...(Array.isArray(data?.data) ? data.data : []));
      after = data?.paging?.next ? data.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return templates;
  }

  /** Submit a new template for Meta's review. Returns its id and initial status. */
  createTemplate(
    wabaId: string,
    accessToken: string,
    template: NewTemplate,
  ): Promise<{ id?: string; status?: string; category?: string }> {
    return this.request("POST", `/${encodeURIComponent(wabaId)}/message_templates`, accessToken, {
      body: { ...template },
    });
  }

  /** Resolve a webhook media id to a 5-minute download URL. */
  getMedia(mediaId: string, accessToken: string): Promise<MediaInfo> {
    return this.request<MediaInfo>("GET", `/${encodeURIComponent(mediaId)}`, accessToken);
  }

  /** Download media bytes from a `getMedia` URL (needs the same Bearer token). */
  async downloadMedia(
    url: string,
    accessToken: string,
    maxBytes: number = DEFAULT_MAX_DOWNLOAD_BYTES,
  ): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "unknown";
      throw new GraphApiError(`Media download network error: ${reason}`, 0);
    }
    if (!response.ok) {
      throw new GraphApiError(
        `Media download failed with status ${response.status}`,
        response.status,
      );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new GraphApiError(`Media too large: ${declared} bytes`, 413);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new GraphApiError(`Media too large: ${buffer.length} bytes`, 413);
    }
    return buffer;
  }

  /** Upload bytes for an outbound media message. Returns the media id. */
  async uploadMedia(
    phoneNumberId: string,
    accessToken: string,
    file: { buffer: Buffer; mimeType: string; filename: string },
  ): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", file.mimeType);
    form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.filename);

    const data = await this.request<{ id?: string }>(
      "POST",
      `/${encodeURIComponent(phoneNumberId)}/media`,
      accessToken,
      { form },
    );
    if (!data?.id) {
      throw new GraphApiError("Graph API media upload returned no id", 502);
    }
    return data.id;
  }
}

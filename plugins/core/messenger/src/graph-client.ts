import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * Messenger Platform client (Facebook Graph API v21.0).
 *
 * The org connects with Facebook Login: core stores a long-lived USER token.
 * Every Page call needs that Page's own token, which `listPages` reads from
 * /me/accounts (Page tokens made from a long-lived user token do not expire).
 *
 * All calls go through `request`, which throws a `GraphApiError` carrying the
 * HTTP status plus Meta's code/subcode, so delivery can branch on the 24-hour
 * window error without re-parsing bodies.
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Messenger's text limit per message. */
export const MAX_TEXT_LENGTH = 2000;

export class GraphApiError extends Error {
  public readonly status: number;
  public readonly code?: number;
  public readonly subcode?: number;

  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.name = "GraphApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

/** Attachment types Messenger accepts by URL. */
export type MessengerAttachmentType = "image" | "video" | "audio" | "file";

/**
 * How a send is classed. RESPONSE = a reply inside the 24-hour window.
 * HUMAN_AGENT = a person replying up to 7 days after the customer's last message
 * (needs Meta's Human Agent permission).
 */
export type SendMode = "response" | "human_agent";

export interface ConnectedPage {
  id: string;
  name?: string;
  accessToken: string;
}

export interface MessengerProfile {
  id: string;
  name?: string;
  profilePic?: string;
}

function sendEnvelope(mode: SendMode): Record<string, string> {
  return mode === "human_agent"
    ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
    : { messaging_type: "RESPONSE" };
}

/** Split text at Messenger's limit, preferring paragraph, line, then word breaks. */
export function splitText(text: string, limit = MAX_TEXT_LENGTH): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (cut < limit / 2) cut = window.lastIndexOf(" ");
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export class GraphClient {
  private logger: HayLogger;

  constructor(options: { logger: HayLogger }) {
    this.logger = options.logger;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    accessToken: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${GRAPH_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error: unknown) {
      // Network-level failure: retryable.
      const reason = error instanceof Error ? error.message : "unknown";
      throw new GraphApiError(`Graph API network error: ${reason}`, 0);
    }

    const text = await response.text();
    let parsed: any = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!response.ok) {
      const metaError = parsed?.error ?? {};
      const message: string =
        metaError.message || `Graph API request failed with status ${response.status}`;
      const code = typeof metaError.code === "number" ? metaError.code : undefined;
      const subcode =
        typeof metaError.error_subcode === "number" ? metaError.error_subcode : undefined;
      this.logger.warn("Graph API request failed", {
        method,
        path,
        status: response.status,
        code,
        subcode,
        message,
      });
      throw new GraphApiError(message, response.status, code, subcode);
    }

    return parsed as T;
  }

  /** The person who connected (their app-scoped id is what Meta's deauthorize callback carries). */
  async getUserId(userToken: string): Promise<string | null> {
    const me = await this.request<{ id?: string | number }>("GET", "/me", userToken, {
      query: { fields: "id" },
    });
    return me.id !== undefined && me.id !== null ? String(me.id) : null;
  }

  /** The Pages the person granted, each with its own Page token. */
  async listPages(userToken: string): Promise<ConnectedPage[]> {
    const data = await this.request<{
      data?: Array<{ id?: string | number; name?: string; access_token?: string }>;
    }>("GET", "/me/accounts", userToken, {
      query: { fields: "id,name,access_token", limit: "100" },
    });
    return (data.data ?? []).flatMap((page) =>
      page.id !== undefined && page.access_token
        ? [{ id: String(page.id), name: page.name, accessToken: page.access_token }]
        : [],
    );
  }

  /**
   * Subscribe a Page to this app's webhooks. Required for inbound messages:
   * the app-level field subscription alone delivers nothing. Idempotent.
   */
  async subscribePage(page: ConnectedPage): Promise<void> {
    await this.request<{ success?: boolean }>(
      "POST",
      `/${encodeURIComponent(page.id)}/subscribed_apps`,
      page.accessToken,
      { query: { subscribed_fields: "messages,message_echoes" } },
    );
    this.logger.info("Messenger Page subscribed to app webhooks", { pageId: page.id });
  }

  /** GET /{psid}?fields=first_name,last_name,profile_pic, with the Page token. */
  async getProfile(psid: string, pageToken: string): Promise<MessengerProfile> {
    const data = await this.request<{
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    }>("GET", `/${encodeURIComponent(psid)}`, pageToken, {
      query: { fields: "first_name,last_name,profile_pic" },
    });
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
    return { id: psid, name: name || undefined, profilePic: data.profile_pic };
  }

  private async send(
    psid: string,
    message: Record<string, unknown>,
    pageToken: string,
    mode: SendMode,
  ): Promise<string> {
    const data = await this.request<{ message_id?: string }>("POST", "/me/messages", pageToken, {
      body: { recipient: { id: psid }, ...sendEnvelope(mode), message },
    });
    if (!data.message_id) {
      throw new GraphApiError("Graph API send returned no message_id", 502);
    }
    return data.message_id;
  }

  /** POST /me/messages with text (at most MAX_TEXT_LENGTH characters). */
  sendText(psid: string, text: string, pageToken: string, mode: SendMode): Promise<string> {
    return this.send(psid, { text }, pageToken, mode);
  }

  /** POST /me/messages with a file Meta downloads from `url` (a short-lived signed Hay.chat link). */
  sendAttachment(
    psid: string,
    attachment: { type: MessengerAttachmentType; url: string },
    pageToken: string,
    mode: SendMode,
  ): Promise<string> {
    return this.send(
      psid,
      {
        attachment: { type: attachment.type, payload: { url: attachment.url, is_reusable: false } },
      },
      pageToken,
      mode,
    );
  }
}

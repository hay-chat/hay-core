import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * Meta Graph API client for Instagram messaging (v21.0).
 *
 * Thin native-fetch wrapper around the handful of Graph endpoints this channel
 * needs:
 *   - getProfile        — resolve an Instagram-scoped sender id (PSID) to a
 *                         display name / username / avatar for the customer record.
 *   - sendText          — deliver an outbound text DM via /me/messages.
 *   - getConnectedAccountIds — resolve the IG business account id(s) backing the
 *                         freshly-stored access token, used as opaque webhook
 *                         routing keys in `onConnected`.
 *
 * All calls go through a single `request` helper that throws a typed
 * `GraphApiError` carrying the HTTP status plus Meta's structured error
 * (code/subcode/message) so callers can branch on, e.g., the 24h messaging
 * window error without re-parsing bodies.
 */

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Structured Meta Graph API error.
 *
 * Meta returns errors as `{ error: { message, type, code, error_subcode, ... } }`.
 * We surface the HTTP status alongside Meta's `code`/`subcode` so delivery can
 * classify retryable vs non-retryable failures (e.g. the 24h window).
 */
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

export interface InstagramProfile {
  /** The Instagram-scoped id (PSID) the profile was resolved for. */
  id: string;
  /** Display name, when the account exposes it. */
  name?: string;
  /** Instagram @username, when available. */
  username?: string;
  /** Profile picture URL, when available. */
  profilePic?: string;
}

export interface GraphClientOptions {
  logger: HayLogger;
}

export class GraphClient {
  private logger: HayLogger;

  constructor(options: GraphClientOptions) {
    this.logger = options.logger;
  }

  /**
   * Single request helper. Appends the access token, parses the JSON body, and
   * throws a `GraphApiError` (carrying status + Meta code/subcode) on any
   * non-2xx response.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    accessToken: string,
    options: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${GRAPH_BASE}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error: any) {
      // Network-level failure (DNS, connection reset, etc.) — treat as retryable.
      throw new GraphApiError(`Graph API network error: ${error?.message ?? "unknown"}`, 0);
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
      const code: number | undefined =
        typeof metaError.code === "number" ? metaError.code : undefined;
      const subcode: number | undefined =
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

  /**
   * Resolve a sender PSID to profile fields for the customer record.
   * GET /{psid}?fields=name,username,profile_pic
   */
  async getProfile(psid: string, accessToken: string): Promise<InstagramProfile> {
    const data = await this.request<{
      name?: string;
      username?: string;
      profile_pic?: string;
    }>("GET", `/${encodeURIComponent(psid)}`, accessToken, {
      query: { fields: "name,username,profile_pic" },
    });

    return {
      id: psid,
      name: data.name,
      username: data.username,
      profilePic: data.profile_pic,
    };
  }

  /**
   * Send an outbound text DM.
   * POST /me/messages { recipient:{id}, message:{text}, messaging_type:"RESPONSE" }
   * Returns the provider message id.
   */
  async sendText(recipientPsid: string, text: string, accessToken: string): Promise<string> {
    const data = await this.request<{ message_id?: string; recipient_id?: string }>(
      "POST",
      "/me/messages",
      accessToken,
      {
        body: {
          recipient: { id: recipientPsid },
          message: { text },
          messaging_type: "RESPONSE",
        },
      },
    );

    const messageId = data.message_id;
    if (!messageId) {
      throw new GraphApiError("Graph API send returned no message_id", 502);
    }
    return messageId;
  }

  /**
   * Resolve the Instagram business account id(s) backing the access token.
   *
   * Two account shapes exist depending on how the org connected:
   *   - Facebook Login for Business: the token is a Page token chain; each
   *     managed Page may expose `instagram_business_account.id`. We page
   *     /me/accounts and collect those ids.
   *   - Instagram API with Instagram Login: GET /me?fields=user_id returns the
   *     IG-scoped account id directly.
   *
   * Both are attempted defensively; any resolved ids are de-duplicated. Failures
   * are logged and yield an empty array (callers must tolerate zero keys — the
   * instance is reconciled later rather than failing the OAuth flow).
   */
  async getConnectedAccountIds(accessToken: string): Promise<string[]> {
    const ids = new Set<string>();

    // Path 1: Pages → instagram_business_account.id
    try {
      const pages = await this.request<{
        data?: Array<{ id?: string; instagram_business_account?: { id?: string } }>;
      }>("GET", "/me/accounts", accessToken, {
        query: { fields: "instagram_business_account" },
      });

      for (const page of pages.data ?? []) {
        const igId = page.instagram_business_account?.id;
        if (igId) {
          ids.add(String(igId));
        }
      }
    } catch (error: any) {
      this.logger.warn("getConnectedAccountIds: /me/accounts lookup failed", {
        error: error?.message,
      });
    }

    // Path 2: IG Login → /me?fields=user_id
    if (ids.size === 0) {
      try {
        const me = await this.request<{ user_id?: string; id?: string }>(
          "GET",
          "/me",
          accessToken,
          { query: { fields: "user_id" } },
        );
        const userId = me.user_id ?? me.id;
        if (userId) {
          ids.add(String(userId));
        }
      } catch (error: any) {
        this.logger.warn("getConnectedAccountIds: /me lookup failed", {
          error: error?.message,
        });
      }
    }

    return Array.from(ids);
  }
}

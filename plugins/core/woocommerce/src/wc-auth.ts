import { randomBytes } from "node:crypto";

/**
 * D16-2 one-click WooCommerce connect, built on WooCommerce's own key-generation
 * endpoint (`/wc-auth/v1/authorize`).
 *
 * 1. The settings UI asks the worker for an authorize URL (`/ui/wc-auth/start`).
 *    The worker mints a single-use nonce, sent to WooCommerce as `user_id`.
 * 2. The store owner approves Hay.chat in their WordPress admin. WooCommerce
 *    POSTs the new keys to `callback_url` (must be HTTPS), which the core plugin
 *    proxy forwards to this worker (`/wc-auth/callback?organizationId=...`).
 * 3. The worker checks the nonce, verifies the keys against `/system_status`
 *    and holds them until the settings UI collects them (`/ui/wc-auth/status`)
 *    and saves them into the plugin config.
 *
 * Plugins cannot write their own config, so the authenticated settings UI does
 * the save; keys never leave this worker except to that org's admin session.
 */

/** A pending connect expires after this long. */
export const SESSION_TTL_MS = 15 * 60 * 1000;
/** Most simultaneous pending connects kept per worker (one org). */
const MAX_SESSIONS = 20;

export interface WcKeys {
  consumerKey: string;
  consumerSecret: string;
  keyPermissions: string;
}

type SessionState =
  | { state: "pending" }
  | { state: "connected"; keys: WcKeys }
  | { state: "error"; code: string; message: string };

interface Session {
  createdAt: number;
  siteUrl: string;
  result: SessionState;
}

export type StatusResult =
  | { state: "pending" }
  | { state: "connected"; consumerKey: string; consumerSecret: string; keyPermissions: string }
  | { state: "error"; code: string; message: string }
  | { state: "unknown" };

export class WcAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WcAuthError";
  }
}

export function normalizeSiteUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new WcAuthError("SITE_URL_MISSING", "Save your WordPress site URL first.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WcAuthError("SITE_URL_INVALID", "The WordPress site URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WcAuthError("SITE_URL_INVALID", "The WordPress site URL must start with https://.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Public HTTPS URL WooCommerce posts the keys to (through the core plugin proxy). */
export function buildCallbackUrl(
  apiUrl: string | undefined,
  pluginId: string,
  orgId: string,
): string {
  if (!apiUrl || !apiUrl.startsWith("https://")) {
    throw new WcAuthError(
      "HTTPS_REQUIRED",
      "One-click connect needs Hay.chat to be reachable over HTTPS. Enter the keys manually instead.",
    );
  }
  const base = apiUrl.replace(/\/+$/, "");
  return `${base}/v1/plugins/${encodeURIComponent(pluginId)}/wc-auth/callback?organizationId=${encodeURIComponent(orgId)}`;
}

export function buildAuthorizeUrl(input: {
  siteUrl: string;
  nonce: string;
  callbackUrl: string;
  returnUrl: string;
}): string {
  const url = new URL(`${input.siteUrl}/wc-auth/v1/authorize`);
  url.searchParams.set("app_name", "Hay.chat");
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("user_id", input.nonce);
  url.searchParams.set("return_url", input.returnUrl);
  url.searchParams.set("callback_url", input.callbackUrl);
  return url.toString();
}

/** Only send the store owner back to Hay.chat's own dashboard. */
export function safeReturnUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** Confirm the keys work and can write, using the same call as onValidateAuth. */
export async function verifyKeys(
  siteUrl: string,
  keys: { consumerKey: string; consumerSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(`${siteUrl}/wp-json/wc/v3/system_status`);
  url.searchParams.set("consumer_key", keys.consumerKey);
  url.searchParams.set("consumer_secret", keys.consumerSecret);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new WcAuthError(
      "STORE_UNREACHABLE",
      `Hay.chat could not reach the store to check the new keys (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    throw new WcAuthError(
      "KEYS_REJECTED",
      `The store rejected the new keys (HTTP ${response.status}).`,
    );
  }
}

export class WcAuthSessions {
  private sessions = new Map<string, Session>();

  constructor(private now: () => number = Date.now) {}

  start(siteUrl: string): string {
    this.prune();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    const nonce = randomBytes(24).toString("hex");
    this.sessions.set(nonce, { createdAt: this.now(), siteUrl, result: { state: "pending" } });
    return nonce;
  }

  /**
   * Handle WooCommerce's key POST. Throws WcAuthError on anything that is not a
   * pending session with valid, read/write keys.
   */
  async receive(body: unknown, fetchImpl: typeof fetch = fetch): Promise<void> {
    this.prune();
    const payload = (body ?? {}) as Record<string, unknown>;
    const nonce = String(payload.user_id ?? "");
    const session = nonce ? this.sessions.get(nonce) : undefined;
    if (!session || session.result.state !== "pending") {
      throw new WcAuthError(
        "UNKNOWN_SESSION",
        "No pending WooCommerce connect matches this callback.",
      );
    }
    const consumerKey = typeof payload.consumer_key === "string" ? payload.consumer_key : "";
    const consumerSecret =
      typeof payload.consumer_secret === "string" ? payload.consumer_secret : "";
    const keyPermissions =
      typeof payload.key_permissions === "string" ? payload.key_permissions : "";
    try {
      if (!consumerKey.startsWith("ck_") || !consumerSecret.startsWith("cs_")) {
        throw new WcAuthError("BAD_KEYS", "WooCommerce sent keys in an unexpected format.");
      }
      if (keyPermissions !== "read_write") {
        throw new WcAuthError(
          "WRONG_PERMISSIONS",
          `Hay.chat needs read/write access, but the keys are "${keyPermissions || "unknown"}".`,
        );
      }
      await verifyKeys(session.siteUrl, { consumerKey, consumerSecret }, fetchImpl);
      session.result = {
        state: "connected",
        keys: { consumerKey, consumerSecret, keyPermissions },
      };
    } catch (error) {
      const err =
        error instanceof WcAuthError ? error : new WcAuthError("VERIFY_FAILED", String(error));
      session.result = { state: "error", code: err.code, message: err.message };
      throw err;
    }
  }

  /** Poll a session. A connected result is handed out once, then forgotten. */
  status(nonce: unknown): StatusResult {
    this.prune();
    const session = typeof nonce === "string" ? this.sessions.get(nonce) : undefined;
    if (!session) return { state: "unknown" };
    const result = session.result;
    if (result.state === "connected") {
      this.sessions.delete(nonce as string);
      return { state: "connected", ...result.keys };
    }
    if (result.state === "error") {
      this.sessions.delete(nonce as string);
      return result;
    }
    return result;
  }

  private prune(): void {
    const cutoff = this.now() - SESSION_TTL_MS;
    for (const [nonce, session] of this.sessions) {
      if (session.createdAt < cutoff) this.sessions.delete(nonce);
    }
  }
}

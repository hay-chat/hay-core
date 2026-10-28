/**
 * Nuvemshop / Tiendanube REST client (native `fetch`, no axios).
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   NUVEMSHOP_STORE_ID       numeric store id (the OAuth `user_id`)
 *   NUVEMSHOP_ACCESS_TOKEN   custom-app (or OAuth) access token
 *   NUVEMSHOP_API_VERSION    default "2025-03"
 *   NUVEMSHOP_MAIN_LANGUAGE  default "pt" (localises i18n fields)
 *
 * API quirks encoded here so tools don't have to care:
 *  - The auth header is `Authentication: bearer <token>` (nonstandard name,
 *    lowercase "bearer"); `Authorization` is rejected with 401.
 *  - `User-Agent` is mandatory (400 without it).
 *  - Rate limit is a leaky bucket (about 2 req/s, burst 40) → 429 with an
 *    X-Rate-Limit-Reset header in milliseconds.
 *  - 402 means the store's subscription lapsed and the whole API is suspended.
 *  - List endpoints 404 ("Last page is N") past the last page instead of
 *    returning [] — `nsList` turns that into an empty page.
 *
 * Every failure is a ToolError from @hay/plugin-sdk/tool-errors (shared `code`
 * vocabulary); NuvemshopApiError additionally keeps the HTTP `status`.
 *
 * Replay policy: 429 was never processed, so any method may retry. A transport
 * error, timeout or 5xx may have been applied server-side (a re-POSTed cancel
 * or coupon would run twice), so only idempotent GETs are replayed.
 */

const {
  ToolError,
  toolError,
  codeForHttpStatus,
  codeForNetworkFailure,
} = require("@hay/plugin-sdk/tool-errors");

// api.nuvemshop.com.br and api.tiendanube.com are interchangeable twins; either
// host serves any store regardless of country.
const API_HOST = "https://api.nuvemshop.com.br";
const DEFAULT_API_VERSION = "2025-03";
const USER_AGENT = "Hay (https://hay.chat)";
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function credentials() {
  const storeId = (process.env.NUVEMSHOP_STORE_ID || "").trim();
  const token = (process.env.NUVEMSHOP_ACCESS_TOKEN || "").trim();
  if (!storeId || !token) {
    throw toolError(
      "INTERNAL",
      "The Nuvemshop connection is not configured (missing store ID or access token).",
    );
  }
  return {
    storeId,
    token,
    apiVersion: process.env.NUVEMSHOP_API_VERSION || DEFAULT_API_VERSION,
  };
}

function mainLanguage() {
  return process.env.NUVEMSHOP_MAIN_LANGUAGE || "pt";
}

/**
 * Shared-vocabulary code for a Nuvemshop error response. 402 (subscription
 * unpaid, API suspended) is the store's own state, not bad credentials.
 */
function nuvemshopErrorCode(method, status) {
  if (status === 402) return "PROVIDER_REFUSED";
  return codeForHttpStatus(status, { idempotent: method === "GET" });
}

class NuvemshopApiError extends ToolError {
  constructor(method, path, status, rawBody) {
    super(
      nuvemshopErrorCode(method, status),
      `Nuvemshop API ${method} ${path} failed: HTTP ${status}: ${describe(status, rawBody)}`,
      { details: { method, path, status } },
    );
    this.name = "NuvemshopApiError";
    this.status = status;
  }
}

function describe(status, rawBody) {
  if (status === 401) {
    return (
      "the access token was rejected. It may have been re-issued or the app uninstalled; " +
      "reconnect the plugin."
    );
  }
  if (status === 402)
    return "the store's Nuvemshop subscription is unpaid, so its API is suspended.";
  if (!rawBody) return "(empty response body)";
  try {
    const parsed = JSON.parse(rawBody);
    const parts = [parsed?.description, parsed?.message, parsed?.error]
      .filter((p) => typeof p === "string" && p)
      .join(" — ");
    // Validation errors come back as { field: ["msg"] }.
    if (!parts && parsed && typeof parsed === "object") return JSON.stringify(parsed).slice(0, 400);
    return parts || rawBody.slice(0, 400);
  } catch {
    return rawBody.slice(0, 400);
  }
}

/**
 * Call the store API and return `{ data, headers }`.
 *
 * @param {string} method
 * @param {string} path - Path under the store, e.g. "/orders/12".
 * @param {object} [options]
 * @param {object} [options.query]
 * @param {object} [options.body]
 */
async function nsRequest(method, path, { query, body } = {}) {
  const { storeId, token, apiVersion } = credentials();
  const url = new URL(`${API_HOST}/${apiVersion}/${storeId}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }

  const headers = {
    Authentication: `bearer ${token}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      if (method === "GET" && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(Math.pow(2, attempt) * 250);
        continue;
      }
      const idempotent = method === "GET";
      throw toolError(
        codeForNetworkFailure({ idempotent }),
        idempotent
          ? "The Nuvemshop store did not respond. Try again in a moment."
          : "Nuvemshop did not confirm whether this change went through. Check the order before trying again.",
        { details: { method, path, cause: err?.message || String(err) } },
      );
    }

    const retryable = response.status === 429 || (response.status >= 500 && method === "GET");
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      const reset = Number(response.headers.get("x-rate-limit-reset"));
      const wait =
        response.status === 429 && Number.isFinite(reset) && reset > 0
          ? Math.min(reset, 5000)
          : Math.pow(2, attempt) * 400;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    if (!response.ok) throw new NuvemshopApiError(method, path, response.status, text);
    return { data: text ? JSON.parse(text) : null, headers: response.headers };
  }
}

/** Convenience: just the JSON body. */
async function nsApi(method, path, options) {
  const { data } = await nsRequest(method, path, options);
  return data;
}

/**
 * List endpoint: `{ items, total }`. `total` comes from X-Total-Count and is
 * null when the header is absent. A 404 past the last page is an empty page.
 */
async function nsList(path, query) {
  try {
    const { data, headers } = await nsRequest("GET", path, { query });
    const raw = headers.get("x-total-count");
    const total = raw === null || raw === "" ? null : Number(raw);
    return {
      items: Array.isArray(data) ? data : [],
      total: Number.isFinite(total) ? total : null,
    };
  } catch (err) {
    if (err instanceof NuvemshopApiError && err.status === 404 && Number(query?.page) > 1) {
      return { items: [], total: null };
    }
    throw err;
  }
}

module.exports = {
  nsRequest,
  nsApi,
  nsList,
  NuvemshopApiError,
  nuvemshopErrorCode,
  mainLanguage,
  API_HOST,
};

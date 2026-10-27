/**
 * WooCommerce REST API client (native `fetch`, no axios).
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   WORDPRESS_SITE_URL           https://mystore.com
 *   WOOCOMMERCE_CONSUMER_KEY     ck_…
 *   WOOCOMMERCE_CONSUMER_SECRET  cs_…
 *
 * Auth goes in the query string (consumer_key / consumer_secret). WooCommerce
 * also accepts HTTP Basic over HTTPS, but many WordPress hosts strip the
 * Authorization header, so the query-string form is the one that works
 * everywhere — and it is what the plugin's connection test already uses.
 *
 * Retries 429 / 5xx with backoff; every other non-2xx is surfaced with the
 * WooCommerce error message and code so the agent can act on it.
 *
 * Every failure is a ToolError from @hay/plugin-sdk/tool-errors: `code` is the
 * shared vocabulary (AUTH_FAILED, SCOPE_MISSING, OUTCOME_UNKNOWN, ...) and
 * WooApiError additionally keeps the HTTP `status` and WooCommerce's `wooCode`.
 */

const { ToolError, toolError, codeForHttpStatus } = require("@hay/plugin-sdk/tool-errors");

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function credentials() {
  const siteUrl = (process.env.WORDPRESS_SITE_URL || "").replace(/\/+$/, "");
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!siteUrl || !consumerKey || !consumerSecret) {
    throw toolError(
      "INTERNAL",
      "The WooCommerce connection is not configured (missing site URL or API key).",
    );
  }
  return { siteUrl, consumerKey, consumerSecret };
}

/**
 * Call the WooCommerce REST API and return `{ data, headers }`.
 *
 * @param {string} method
 * @param {string} path - Path under the namespace, e.g. "/orders/12".
 * @param {object} [options]
 * @param {object} [options.query]
 * @param {object} [options.body]
 * @param {string} [options.namespace] - REST namespace (default "wc/v3").
 */
async function wcRequest(method, path, { query, body, namespace = "wc/v3" } = {}) {
  const { siteUrl, consumerKey, consumerSecret } = credentials();
  const url = new URL(`${siteUrl}/wp-json/${namespace}${path}`);
  url.searchParams.set("consumer_key", consumerKey);
  url.searchParams.set("consumer_secret", consumerSecret);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

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
      // A timed-out POST may have been processed server-side (a refund that
      // takes >30s still refunds), so only idempotent GETs are retried.
      if (method === "GET" && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(Math.pow(2, attempt) * 250);
        continue;
      }
      const details = { method, path, cause: err?.message || String(err) };
      if (method === "GET") {
        throw toolError(
          "PROVIDER_DOWN",
          "The WooCommerce store did not respond. Try again in a moment.",
          {
            details,
          },
        );
      }
      throw toolError("OUTCOME_UNKNOWN", OUTCOME_UNKNOWN_MESSAGE, { details });
    }

    // 429 was never processed, so any request may be retried. A 5xx may have
    // been processed (a refund POST that times out server-side still refunds),
    // so only idempotent GETs are retried on it.
    const retryable = response.status === 429 || (response.status >= 500 && method === "GET");
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      await sleep(Math.pow(2, attempt) * 500);
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new WooApiError(method, path, response.status, text);
    }
    return { data: text ? JSON.parse(text) : null, headers: response.headers };
  }
}

/** Convenience: just the JSON body. */
async function wcApi(method, path, options) {
  const { data } = await wcRequest(method, path, options);
  return data;
}

/** List endpoint: `{ items, total, totalPages }` from the X-WP-* headers. */
async function wcList(path, query, options = {}) {
  const { data, headers } = await wcRequest("GET", path, { ...options, query });
  return {
    items: Array.isArray(data) ? data : [],
    total: Number(headers.get("x-wp-total") || 0),
    totalPages: Number(headers.get("x-wp-totalpages") || 0),
  };
}

const OUTCOME_UNKNOWN_MESSAGE =
  "WooCommerce did not confirm whether this change went through. Check the order before trying again.";

/**
 * Shared-vocabulary code for a WooCommerce error response. WooCommerce answers a
 * write with a read-only key with 401 `woocommerce_rest_cannot_create|edit|...`,
 * which is a permission problem, not bad credentials.
 */
function wooErrorCode(method, status, wooCode) {
  const idempotent = method === "GET";
  if (
    (status === 401 || status === 403) &&
    /_cannot_(create|edit|delete|batch|update)/.test(wooCode || "")
  ) {
    return "SCOPE_MISSING";
  }
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 400) {
    return /^rest_(invalid_param|missing_callback_param)/.test(wooCode || "")
      ? "BAD_INPUT"
      : "PROVIDER_REFUSED";
  }
  // A 5xx with a structured WordPress error (e.g. the gateway declined a refund) is
  // WooCommerce answering "no", not an unknown outcome.
  if (status >= 500 && !idempotent && wooCode) return "PROVIDER_REFUSED";
  return codeForHttpStatus(status, { idempotent });
}

function wooErrorMessage(code, parsed) {
  switch (code) {
    case "AUTH_FAILED":
      return "WooCommerce rejected Hay.chat's API key. The store needs to reconnect WooCommerce in Hay.chat.";
    case "SCOPE_MISSING":
      return (
        "The WooCommerce API key connected to Hay.chat can't make this change (it may be " +
        "read-only). The store needs to reconnect with a Read/Write key."
      );
    case "RATE_LIMITED":
      return "The WooCommerce store is limiting requests right now. Try again shortly.";
    case "PROVIDER_DOWN":
      return "The WooCommerce store is having problems. Try again in a moment.";
    case "OUTCOME_UNKNOWN":
      return OUTCOME_UNKNOWN_MESSAGE;
    case "NOT_FOUND":
      return `WooCommerce couldn't find it: ${parsed.message}`;
    default:
      return `WooCommerce refused: ${parsed.message}`;
  }
}

class WooApiError extends ToolError {
  constructor(method, path, status, rawBody) {
    const parsed = parseBody(rawBody);
    const code = wooErrorCode(method, status, parsed.code);
    super(code, wooErrorMessage(code, parsed), {
      details: { method, path, status, wooCode: parsed.code },
    });
    this.name = "WooApiError";
    this.status = status;
    this.wooCode = parsed.code;
  }
}

function parseBody(rawBody) {
  if (!rawBody) return { message: "(empty response body)", code: null };
  try {
    const parsed = JSON.parse(rawBody);
    const message = typeof parsed?.message === "string" ? parsed.message : rawBody.slice(0, 400);
    return {
      message: parsed?.code ? `${message} (${parsed.code})` : message,
      code: parsed?.code ?? null,
    };
  } catch {
    return { message: rawBody.slice(0, 400), code: null };
  }
}

module.exports = { wcRequest, wcApi, wcList, WooApiError, wooErrorCode };

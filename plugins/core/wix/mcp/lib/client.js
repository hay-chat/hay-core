/**
 * Wix eCommerce REST API client.
 *
 * Native `fetch` (no axios), one shared `wixApi()` helper that centralises the
 * Wix auth headers + query serialization, with retry on 429 / 5xx. Reads
 * WIX_API_KEY and WIX_SITE_ID from the environment (injected by the plugin
 * worker).
 *
 * Wix API-key auth: the key goes RAW in the `Authorization` header (no "Bearer"
 * prefix), and every site-level call must carry the `wix-site-id` header.
 * All endpoints live under https://www.wixapis.com.
 */

const BASE_URL = "https://www.wixapis.com";
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const API_KEY = process.env.WIX_API_KEY;
const SITE_ID = process.env.WIX_SITE_ID;

if (!API_KEY || !SITE_ID) {
  console.error("ERROR: WIX_API_KEY and WIX_SITE_ID environment variables are required");
  process.exit(1);
}

/**
 * Call the Wix REST API.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE).
 * @param {string} path - Path beginning with "/", relative to https://www.wixapis.com.
 * @param {object} [options]
 * @param {object} [options.query] - Query params. Values may be strings/numbers/booleans/arrays
 *   (arrays become comma-separated).
 * @param {object} [options.body] - Optional JSON request body.
 * @returns {Promise<any>} Parsed JSON response body (or `null` for 204).
 */
async function wixApi(method, path, { query, body } = {}) {
  const url = new URL(BASE_URL + path);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        url.searchParams.set(key, value.join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    Authorization: API_KEY,
    "wix-site-id": SITE_ID,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let attempt = 0;
  // Retry loop: transient 429 / 5xx are retried with backoff; everything else
  // (including 4xx) is surfaced to the caller as a descriptive error.
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
      // Network/timeout error — retry a couple of times then give up.
      if (attempt < MAX_RETRIES) {
        const wait = Math.pow(2, attempt) * 500;
        console.error(`[wix] network error, retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms`);
        attempt += 1;
        await sleep(wait);
        continue;
      }
      throw new Error(`Wix API ${method} ${path} failed: ${err.message || String(err)}`);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfterHeader = Number(response.headers.get("retry-after"));
      const wait =
        response.status === 429 && retryAfterHeader
          ? retryAfterHeader * 1000
          : Math.pow(2, attempt) * 1000;
      console.error(
        `[wix] retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms (HTTP ${response.status})`,
      );
      attempt += 1;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new WixApiError(method, path, response.status, text);
    }
    return text ? JSON.parse(text) : null;
  }
}

/**
 * Error carrying the HTTP status and the parsed Wix error body, so callers can
 * render the actual reason (missing permission, validation message, provider
 * not refundable) instead of an opaque "status code 400".
 */
class WixApiError extends Error {
  constructor(method, path, status, rawBody) {
    super(`Wix API ${method} ${path} failed: HTTP ${status}: ${formatBody(rawBody)}`);
    this.name = "WixApiError";
    this.status = status;
  }
}

function formatBody(rawBody) {
  if (!rawBody) return "(empty response body)";
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return rawBody.slice(0, 600);
  }
  // Wix errors look like:
  //   { message, details: { applicationError: { description, code, data } } }
  //   { message, details: { validationError: { fieldViolations: [{ description }] } } }
  const appError = parsed?.details?.applicationError;
  if (appError?.description) {
    return appError.code ? `${appError.description} (${appError.code})` : appError.description;
  }
  const violations = parsed?.details?.validationError?.fieldViolations;
  if (Array.isArray(violations) && violations.length) {
    return violations
      .map((v) => v?.description || v?.field)
      .filter(Boolean)
      .join("; ");
  }
  if (typeof parsed.message === "string" && parsed.message) {
    return parsed.message;
  }
  return rawBody.slice(0, 600);
}

module.exports = { wixApi, WixApiError, BASE_URL };

/**
 * Twenty REST API client.
 *
 * Native `fetch` (no axios), one shared `twentyApi()` helper that centralises
 * auth headers + query serialization, with retry on 429 / 5xx. Reads
 * TWENTY_URL and TWENTY_API_KEY from the environment (injected by the plugin
 * worker). The data-plane lives under `${TWENTY_URL}/rest`, the schema/metadata
 * plane under `${TWENTY_URL}/rest/metadata`.
 */

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeBaseUrl(raw) {
  let url = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (url.toLowerCase().endsWith("/rest")) {
    url = url.slice(0, -"/rest".length);
  }
  return url;
}

const BASE_URL = normalizeBaseUrl(process.env.TWENTY_URL);
const API_KEY = process.env.TWENTY_API_KEY;

if (!BASE_URL || !API_KEY) {
  console.error("ERROR: TWENTY_URL and TWENTY_API_KEY environment variables are required");
  process.exit(1);
}

/**
 * Call the Twenty REST API.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE).
 * @param {string} path - Path beginning with "/", relative to the REST root.
 * @param {object} [options]
 * @param {object} [options.query] - Query params (filter, limit, starting_after, order_by, depth…).
 *   Values may be strings/numbers/booleans/arrays (arrays become comma-separated).
 * @param {object} [options.body] - Optional JSON request body.
 * @param {boolean} [options.metadata] - Target the metadata plane (`/rest/metadata`) instead of `/rest`.
 * @returns {Promise<any>} Parsed JSON response body (or `null` for 204).
 */
async function twentyApi(method, path, { query, body, metadata = false } = {}) {
  const root = metadata ? `${BASE_URL}/rest/metadata` : `${BASE_URL}/rest`;
  const url = new URL(root + path);

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
    Authorization: `Bearer ${API_KEY}`,
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
        console.error(
          `[twenty] network error, retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms`,
        );
        attempt += 1;
        await sleep(wait);
        continue;
      }
      throw new Error(`Twenty API ${method} ${path} failed: ${err.message || String(err)}`);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfterHeader = Number(response.headers.get("retry-after"));
      const wait =
        response.status === 429 && retryAfterHeader
          ? retryAfterHeader * 1000
          : Math.pow(2, attempt) * 1000;
      console.error(
        `[twenty] retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms (HTTP ${response.status})`,
      );
      attempt += 1;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new TwentyApiError(method, path, response.status, text);
    }
    return text ? JSON.parse(text) : null;
  }
}

/**
 * Error carrying the HTTP status and the parsed Twenty error body, so callers
 * can render the actual reason (missing field, bad enum, validation message)
 * instead of an opaque "status code 400".
 */
class TwentyApiError extends Error {
  constructor(method, path, status, rawBody) {
    super(`Twenty API ${method} ${path} failed: HTTP ${status}: ${formatBody(rawBody)}`);
    this.name = "TwentyApiError";
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
  // Twenty REST errors look like { messages: ["..."], error: "Bad Request" }
  // or { message: "..." } or { errors: [{ message }] }.
  if (Array.isArray(parsed.messages) && parsed.messages.length) {
    return parsed.messages.filter((m) => typeof m === "string").join("; ");
  }
  if (typeof parsed.message === "string" && parsed.message) {
    return parsed.message;
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length) {
    return parsed.errors
      .map((e) => (typeof e === "string" ? e : e?.message || JSON.stringify(e)))
      .filter(Boolean)
      .join("; ");
  }
  return rawBody.slice(0, 600);
}

module.exports = { twentyApi, TwentyApiError, normalizeBaseUrl };

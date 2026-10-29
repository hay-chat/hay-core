/**
 * Spacebring REST client (native `fetch`, no axios).
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   SPACEBRING_API_KEY_ID      Basic-auth username
 *   SPACEBRING_API_KEY_SECRET  Basic-auth password
 *
 * Every failure is a ToolError from @hay/plugin-sdk/tool-errors (shared `code`
 * vocabulary); SpacebringApiError additionally keeps the HTTP `status`.
 *
 * Replay policy: 429 was never processed, so any method may retry. A transport
 * error, timeout or 5xx may have been applied server-side (a re-POSTed booking
 * would book twice), so only idempotent GETs are replayed.
 */

const {
  ToolError,
  toolError,
  codeForHttpStatus,
  codeForNetworkFailure,
} = require("@hay/plugin-sdk/tool-errors");

const BASE_URL = "https://api.spacebring.com";
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const PAGE_SIZE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authHeader() {
  const id = (process.env.SPACEBRING_API_KEY_ID || "").trim();
  const secret = (process.env.SPACEBRING_API_KEY_SECRET || "").trim();
  if (!id || !secret) {
    throw toolError(
      "INTERNAL",
      "The Spacebring connection is not configured (missing API key ID or secret).",
    );
  }
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

class SpacebringApiError extends ToolError {
  constructor(method, path, status, rawBody) {
    super(
      codeForHttpStatus(status, { idempotent: method === "GET" }),
      providerMessage(status, rawBody),
      {
        details: { method, path, status },
      },
    );
    this.name = "SpacebringApiError";
    this.status = status;
  }
}

/** The human part of a Spacebring error body, so the agent can relay the actual reason. */
function providerMessage(status, rawBody) {
  if (status === 401) {
    return "Spacebring rejected the API credentials. The plugin needs to be reconnected in Hay.";
  }
  if (status === 403) {
    return "The Spacebring API key is not allowed to do this. The space admin must grant it access.";
  }
  if (!rawBody) return `Spacebring answered HTTP ${status} with no details.`;
  try {
    const parsed = JSON.parse(rawBody);
    const err = parsed?.error ?? parsed;
    const parts = [err?.message, err?.description, err?.detail, parsed?.message]
      .filter((p) => typeof p === "string" && p)
      .filter((p, i, all) => all.indexOf(p) === i);
    if (parts.length) return `Spacebring refused: ${parts.join(" — ")}`;
    return `Spacebring answered HTTP ${status}: ${JSON.stringify(parsed).slice(0, 300)}`;
  } catch {
    return `Spacebring answered HTTP ${status}: ${rawBody.slice(0, 300)}`;
  }
}

/**
 * Call the Spacebring API and return the parsed JSON body (null for 204).
 *
 * @param {string} method
 * @param {string} path - Path beginning with "/", e.g. "/resources/bookings/v1".
 * @param {{ query?: object, body?: object }} [options]
 */
async function sbApi(method, path, { query, body } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }

  const headers = { Authorization: authHeader(), Accept: "application/json" };
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
      if (method === "GET" && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(Math.pow(2, attempt) * 250);
        continue;
      }
      const idempotent = method === "GET";
      throw toolError(
        codeForNetworkFailure({ idempotent }),
        idempotent
          ? "Spacebring did not respond. Try again in a moment."
          : "Spacebring did not confirm whether this change went through. Check the member's " +
              "bookings/visits with spacebring_get_member before trying again.",
        { details: { method, path, cause: err?.message || String(err) } },
      );
    }

    const retryable = response.status === 429 || (response.status >= 500 && method === "GET");
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        response.status === 429 && retryAfter > 0
          ? Math.min(retryAfter * 1000, 5000)
          : Math.pow(2, attempt) * 400;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    if (!response.ok) throw new SpacebringApiError(method, path, response.status, text);
    return text ? JSON.parse(text) : null;
  }
}

/**
 * The array in a list response. Spacebring wraps lists under the resource name
 * (`{ bookings: [...], nextPageToken }`); fall back to the usual alternatives.
 */
function listOf(response, key) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];
  for (const k of [key, "items", "data", "results"]) {
    if (Array.isArray(response[k])) return response[k];
  }
  return [];
}

/** The object in a single-item response (`{ booking: {...} }` or the bare object). */
function itemOf(response, key) {
  if (
    response &&
    typeof response === "object" &&
    response[key] &&
    typeof response[key] === "object"
  ) {
    return response[key];
  }
  return response;
}

/**
 * Read every page of a list endpoint (up to `maxPages`), following
 * `nextPageToken`. Returns `{ items, truncated }`.
 */
async function sbListAll(path, key, query = {}, { maxPages = 5 } = {}) {
  const items = [];
  let pageToken;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await sbApi("GET", path, {
      query: { ...query, limit: PAGE_SIZE, nextPageToken: pageToken },
    });
    items.push(...listOf(res, key));
    pageToken = res?.nextPageToken;
    if (!pageToken) return { items, truncated: false };
  }
  return { items, truncated: true };
}

module.exports = { sbApi, sbListAll, listOf, itemOf, SpacebringApiError, BASE_URL };

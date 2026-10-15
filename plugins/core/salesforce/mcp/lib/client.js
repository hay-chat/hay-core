/**
 * Salesforce REST API client.
 *
 * Native `fetch` (no axios). One shared `sfApi()` helper centralises the OAuth
 * access token, auth headers, query serialization, retry on 429/5xx, and a
 * single transparent re-auth on 401 (the access token expired). Reads the
 * connected-app credentials from the environment, injected by the plugin worker:
 *
 *   SALESFORCE_INSTANCE_URL    My Domain URL, e.g. https://acme.my.salesforce.com
 *   SALESFORCE_CLIENT_ID       Connected App consumer key
 *   SALESFORCE_CLIENT_SECRET   Connected App consumer secret
 *
 * Auth uses the OAuth 2.0 Client Credentials Flow: POST the credentials to
 * `/services/oauth2/token` and reuse the returned access token + instance URL.
 * Client-credentials tokens carry no refresh token — when one expires we simply
 * request a new one.
 */

// Salesforce REST/SOQL API version. v60.0 = Spring '24, available on every
// supported org. Bump deliberately; newer fields/endpoints may not exist on
// older org releases.
const API_VERSION = "v60.0";

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeInstanceUrl(raw) {
  return String(raw || "")
    .trim()
    .replace(/\/+$/, "");
}

const LOGIN_URL = normalizeInstanceUrl(process.env.SALESFORCE_INSTANCE_URL);
const CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
const CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;

if (!LOGIN_URL || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "ERROR: SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET " +
      "environment variables are required",
  );
  process.exit(1);
}

// Cached session: the access token and the instance URL Salesforce tells us to
// use for data API calls (may differ from the login URL).
let session = null;

/** Obtain a fresh access token via the Client Credentials Flow. */
async function authenticate() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const response = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Salesforce token endpoint returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  if (!response.ok || !parsed.access_token) {
    const detail = parsed.error_description || parsed.error || text.slice(0, 200);
    throw new Error(`Salesforce authentication failed (HTTP ${response.status}): ${detail}`);
  }

  session = {
    accessToken: parsed.access_token,
    instanceUrl: normalizeInstanceUrl(parsed.instance_url || LOGIN_URL),
  };
  return session;
}

/** Ensure we have a session, authenticating lazily on first use. */
async function getSession() {
  if (!session) await authenticate();
  return session;
}

/**
 * Call the Salesforce REST API.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE).
 * @param {string} path - Path beginning with "/", relative to the data API root
 *   (`/services/data/<version>`). e.g. "/sobjects/Contact/003...", "/query".
 * @param {object} [options]
 * @param {object} [options.query] - Query params. Arrays become comma-separated.
 * @param {object} [options.body] - Optional JSON request body.
 * @returns {Promise<any>} Parsed JSON response body (or `null` for 204 No Content).
 */
async function sfApi(method, path, { query, body } = {}) {
  let reauthed = false;
  let attempt = 0;

  while (true) {
    const { accessToken, instanceUrl } = await getSession();
    const url = new URL(`${instanceUrl}/services/data/${API_VERSION}${path}`);

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
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const wait = Math.pow(2, attempt) * 500;
        console.error(`[salesforce] network error, retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms`);
        attempt += 1;
        await sleep(wait);
        continue;
      }
      throw new Error(`Salesforce API ${method} ${path} failed: ${err.message || String(err)}`);
    }

    // Expired/invalid token — drop the session and re-authenticate once.
    if (response.status === 401 && !reauthed) {
      console.error("[salesforce] access token rejected (401) — re-authenticating");
      reauthed = true;
      session = null;
      continue;
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait =
        response.status === 429 && retryAfter
          ? retryAfter * 1000
          : Math.pow(2, attempt) * 1000;
      console.error(`[salesforce] retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms (HTTP ${response.status})`);
      attempt += 1;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    if (!response.ok) {
      throw new SalesforceApiError(method, path, response.status, text);
    }
    return text ? JSON.parse(text) : null;
  }
}

/**
 * Error carrying the HTTP status and the parsed Salesforce error body so callers
 * can render the actual reason (required field missing, bad SOQL, invalid id)
 * instead of an opaque status code.
 */
class SalesforceApiError extends Error {
  constructor(method, path, status, rawBody) {
    super(`Salesforce API ${method} ${path} failed: HTTP ${status}: ${formatBody(rawBody)}`);
    this.name = "SalesforceApiError";
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
  // Salesforce REST errors are an array: [{ message, errorCode, fields: [] }].
  if (Array.isArray(parsed) && parsed.length) {
    return parsed
      .map((e) => {
        const fields = Array.isArray(e.fields) && e.fields.length ? ` (fields: ${e.fields.join(", ")})` : "";
        return `${e.errorCode ? `[${e.errorCode}] ` : ""}${e.message || JSON.stringify(e)}${fields}`;
      })
      .join("; ");
  }
  if (typeof parsed.error_description === "string") return parsed.error_description;
  if (typeof parsed.message === "string") return parsed.message;
  return rawBody.slice(0, 600);
}

module.exports = { sfApi, SalesforceApiError, API_VERSION };

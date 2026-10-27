// lib/client.js — shared Nuvemshop / Tiendanube REST client.
//
// Reads credentials from env (injected by the plugin entry's startLocalStdio):
//   NUVEMSHOP_STORE_ID, NUVEMSHOP_ACCESS_TOKEN, NUVEMSHOP_API_VERSION,
//   NUVEMSHOP_MAIN_LANGUAGE.
//
// API quirks encoded here so tools don't have to care:
//  - Auth header is `Authentication: bearer <token>` (nonstandard name,
//    lowercase "bearer") — `Authorization` is rejected with 401.
//  - `User-Agent` is mandatory (400 without it).
//  - Rate limit is a leaky bucket (~2 req/s, burst 40) → 429 with an
//    X-Rate-Limit-Reset header in milliseconds.
//  - 402 means the store's subscription lapsed and the whole API is suspended.

const STORE_ID = process.env.NUVEMSHOP_STORE_ID;
const TOKEN = process.env.NUVEMSHOP_ACCESS_TOKEN;
const API_VERSION = process.env.NUVEMSHOP_API_VERSION || "2025-03";
const MAIN_LANGUAGE = process.env.NUVEMSHOP_MAIN_LANGUAGE || "pt";

// api.nuvemshop.com.br and api.tiendanube.com are interchangeable twins.
const API_HOST = "https://api.nuvemshop.com.br";
const USER_AGENT = "Hay (https://hay.chat)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single request helper: builds auth headers, serializes query params,
 * normalizes errors, and retries transport errors / 429 / 5xx.
 *
 * Returns the parsed JSON body. Pass `{ withMeta: true }` to instead get
 * `{ data, total }` where `total` is the X-Total-Count header (list endpoints).
 */
async function nuvemshopApi(method, path, { query, body, withMeta } = {}) {
  if (!STORE_ID || !TOKEN) {
    throw new Error("Nuvemshop MCP server is missing NUVEMSHOP_STORE_ID or NUVEMSHOP_ACCESS_TOKEN");
  }

  const url = new URL(`${API_HOST}/${API_VERSION}/${STORE_ID}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }

  const headers = {
    Authentication: `bearer ${TOKEN}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

  // Replay policy: transport errors and 5xx may have been applied server-side,
  // so only GETs are replayed (a re-POSTed /orders/{id}/cancel would hit an
  // already-cancelled order and report a false failure). 429 means the server
  // refused the request, so any method may retry.
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      lastError = err;
      if (method === "GET" && attempt < maxAttempts) {
        await sleep(attempt * 500);
        continue;
      }
      throw new Error(`Nuvemshop request failed: ${err.message || err}`);
    }

    if (res.status === 429 || (res.status >= 500 && method === "GET")) {
      if (attempt < maxAttempts) {
        // X-Rate-Limit-Reset is milliseconds until the bucket drains.
        const reset = Number(res.headers.get("x-rate-limit-reset"));
        const wait =
          res.status === 429 && Number.isFinite(reset) && reset > 0
            ? Math.min(reset, 5000)
            : attempt * 800;
        await sleep(wait);
        continue;
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let err;
      if (res.status === 402) {
        err = new Error("Nuvemshop API suspended (HTTP 402): the store's subscription is unpaid.");
      } else if (res.status === 401) {
        err = new Error(
          "Nuvemshop rejected the access token (HTTP 401). The token may have been " +
            "re-issued or the app uninstalled — reconnect the plugin.",
        );
      } else {
        err = new Error(
          `Nuvemshop ${method} ${path} failed (HTTP ${res.status}): ${text.slice(0, 300)}`,
        );
      }
      err.status = res.status;
      throw err;
    }

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (withMeta) {
      // Absent header must yield undefined, not 0 (Number(null) === 0 trap).
      const rawTotal = res.headers.get("x-total-count");
      const total = rawTotal === null || rawTotal === "" ? undefined : Number(rawTotal);
      return { data, total: Number.isFinite(total) ? total : undefined };
    }
    return data;
  }

  throw new Error(`Nuvemshop request failed after retries: ${lastError?.message || lastError}`);
}

module.exports = { nuvemshopApi, STORE_ID, API_VERSION, MAIN_LANGUAGE };

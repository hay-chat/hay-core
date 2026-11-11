/**
 * Melhor Envio REST client (native `fetch`). Read-only: every call is a GET.
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   MELHOR_ENVIO_ACCESS_TOKEN  bearer token the merchant generated in their panel
 *   MELHOR_ENVIO_USER_AGENT    "App (contact email)"; Melhor Envio requires it on every request
 *
 * Every failure is a ToolError from @hay/plugin-sdk/tool-errors (shared `code`
 * vocabulary); MelhorEnvioApiError additionally keeps the HTTP `status`.
 *
 * Melhor Envio allows 250 requests per minute per authenticated user (docs FAQ).
 * GETs are idempotent, so a transport error, 429 or 5xx is retried with backoff.
 */

const {
  ToolError,
  toolError,
  codeForHttpStatus,
  codeForNetworkFailure,
} = require("@hay/plugin-sdk/tool-errors");

// Production only. The sandbox (sandbox.melhorenvio.com.br) is a separate account
// with separate tokens; no neighbouring plugin has a sandbox switch to follow.
const BASE_URL = "https://melhorenvio.com.br";
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestHeaders() {
  const token = (process.env.MELHOR_ENVIO_ACCESS_TOKEN || "").trim();
  const userAgent = (process.env.MELHOR_ENVIO_USER_AGENT || "").trim();
  if (!token || !userAgent) {
    throw toolError(
      "INTERNAL",
      "The Melhor Envio connection is not configured (missing access token or contact email).",
    );
  }
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": userAgent };
}

class MelhorEnvioApiError extends ToolError {
  constructor(path, status, rawBody) {
    super(codeForHttpStatus(status, { idempotent: true }), providerMessage(status, rawBody), {
      details: { path, status },
    });
    this.name = "MelhorEnvioApiError";
    this.status = status;
    // The detail route answers 404 for an unknown id; the search route is documented
    // to answer 400 { "error": "Not Found" } when nothing matches.
    // TODO(verify): confirm the search route's no-match response against a live account.
    this.notFound = status === 404 || (status === 400 && /not found/i.test(rawBody || ""));
  }
}

/** The human part of a Melhor Envio error body (`{ message, errors }` or `{ error }`). */
function providerMessage(status, rawBody) {
  if (status === 401) {
    return (
      "Melhor Envio rejected the access token (it may have expired or been revoked). The " +
      "merchant needs to generate a new token in Melhor Envio and save it in the plugin settings."
    );
  }
  if (status === 403) {
    return (
      "The Melhor Envio token is not allowed to read shipments. The merchant needs to generate " +
      "a token with permission to view shipping labels (orders-read)."
    );
  }
  if (status === 429) {
    return "Melhor Envio is limiting requests (250 per minute). Try again in a minute.";
  }
  if (!rawBody) return `Melhor Envio answered HTTP ${status} with no details.`;
  try {
    const parsed = JSON.parse(rawBody);
    const fieldErrors = Object.values(parsed?.errors || {}).flat();
    const parts = [parsed?.message, parsed?.error, ...fieldErrors]
      .filter((p) => typeof p === "string" && p)
      .filter((p, i, all) => all.indexOf(p) === i);
    if (parts.length) return `Melhor Envio refused: ${parts.join(" — ")}`;
    return `Melhor Envio answered HTTP ${status}: ${JSON.stringify(parsed).slice(0, 300)}`;
  } catch {
    // An HTML error page says nothing useful to the agent.
    return `Melhor Envio answered HTTP ${status}.`;
  }
}

/**
 * GET a Melhor Envio API path and return the parsed JSON body.
 *
 * @param {string} path - Path beginning with "/", e.g. "/api/v2/me/orders/search".
 * @param {Record<string, string>} [query]
 */
async function meGet(path, query) {
  const headers = requestHeaders();
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(Math.pow(2, attempt) * 250);
        continue;
      }
      throw toolError(
        codeForNetworkFailure({ idempotent: true }),
        "Melhor Envio did not respond. Try again in a moment.",
        { details: { path, cause: err?.message || String(err) } },
      );
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
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
    if (!response.ok) throw new MelhorEnvioApiError(path, response.status, text);
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw toolError("PROVIDER_DOWN", "Melhor Envio returned a response that is not JSON.", {
        details: { path, status: response.status },
      });
    }
  }
}

module.exports = { meGet, MelhorEnvioApiError, BASE_URL };

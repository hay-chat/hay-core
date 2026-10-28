/**
 * Mercado Pago REST client (native `fetch`, no SDK dependency).
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   MERCADOPAGO_ACCESS_TOKEN   the seller's OAuth access token
 *
 * Every failure is a ToolError from @hay/plugin-sdk/tool-errors (shared `code`
 * vocabulary); MercadoPagoApiError also keeps the HTTP `status`.
 *
 * Replay policy: 429 was never processed, so any method may retry. A transport
 * error, timeout or 5xx may have been applied (a re-POSTed refund could run
 * twice without its idempotency key), so only GETs are replayed here.
 *
 * @see https://www.mercadopago.com.br/developers/en/reference
 */

const {
  ToolError,
  toolError,
  codeForHttpStatus,
  codeForNetworkFailure,
} = require("@hay/plugin-sdk/tool-errors");

const API_HOST = "https://api.mercadopago.com";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function accessToken() {
  const token = (process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  if (!token) {
    throw toolError(
      "AUTH_FAILED",
      "Mercado Pago is not connected. Connect it again from the plugin page.",
    );
  }
  return token;
}

class MercadoPagoApiError extends ToolError {
  constructor(method, path, status, rawBody) {
    super(
      codeForHttpStatus(status, { idempotent: method === "GET" }),
      `Mercado Pago ${method} ${path} failed: HTTP ${status}: ${describe(status, rawBody)}`,
      { details: { method, path, status } },
    );
    this.name = "MercadoPagoApiError";
    this.status = status;
  }
}

function describe(status, rawBody) {
  if (status === 401) {
    return "the connection was rejected (expired or revoked). Reconnect Mercado Pago.";
  }
  if (!rawBody) return "(empty response body)";
  try {
    const parsed = JSON.parse(rawBody);
    const causes = Array.isArray(parsed?.cause)
      ? parsed.cause.map((c) => c?.description).filter(Boolean)
      : [];
    const parts = [parsed?.message, parsed?.error, ...causes].filter(
      (p) => typeof p === "string" && p,
    );
    return parts.join(" — ").slice(0, 400) || rawBody.slice(0, 400);
  } catch {
    return rawBody.slice(0, 400);
  }
}

/**
 * Call the API and return the JSON body.
 *
 * @param {string} method
 * @param {string} path - e.g. "/v1/payments/123".
 * @param {{ query?: object, body?: object, headers?: object }} [options]
 */
async function mpApi(method, path, { query, body, headers: extra } = {}) {
  const url = new URL(`${API_HOST}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  }
  const headers = {
    Authorization: `Bearer ${accessToken()}`,
    Accept: "application/json",
    ...extra,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const idempotent = method === "GET";
      if (idempotent && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(attempt * 300);
        continue;
      }
      throw toolError(
        codeForNetworkFailure({ idempotent }),
        idempotent
          ? "Mercado Pago did not respond. Try again in a moment."
          : "Mercado Pago did not confirm whether this went through. Check the refund status " +
              "before trying again.",
        { details: { method, path, cause: err?.message || String(err) } },
      );
    }

    const retryable = response.status === 429 || (response.status >= 500 && method === "GET");
    if (retryable && attempt < MAX_RETRIES) {
      attempt += 1;
      await sleep(attempt * 500);
      continue;
    }

    const text = await response.text();
    if (!response.ok) throw new MercadoPagoApiError(method, path, response.status, text);
    return text ? JSON.parse(text) : null;
  }
}

module.exports = { mpApi, MercadoPagoApiError, API_HOST };

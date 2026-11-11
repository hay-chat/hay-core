/**
 * Correios CWS REST client (native `fetch`): Token API + SRO Rastro.
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   CORREIOS_USERNAME      Meu Correios user (idCorreios / CNPJ)
 *   CORREIOS_ACCESS_CODE   API access code ("código de acesso") generated in CWS
 *   CORREIOS_POSTING_CARD  cartão de postagem number (optional if a contract is set)
 *   CORREIOS_CONTRACT      contract number (optional if a posting card is set)
 *
 * Verified against the public OpenAPI documents
 * (https://api.correios.com.br/token/v3/api-docs and /srorastro/v3/api-docs):
 *  - POST /token/v1/autentica/cartaopostagem  body { numero, contrato? }
 *    POST /token/v1/autentica/contrato        body { numero }
 *    with `Authorization: Basic base64(user:accessCode)` → 201 { token, expiraEm, zoneOffset, … }.
 *  - The same token is returned until it expires (the manual says 24 h; a new
 *    one is issued from 30 minutes before `expiraEm`), and the Token API allows
 *    3 requests per second, so the token is cached until shortly before `expiraEm`.
 *  - GET /srorastro/v1/objetos/{codigoObjeto}?resultado=T with
 *    `Authorization: Bearer <token>` → 200 { objetos: [ { codObjeto, eventos, mensagem, … } ] }.
 *  - Errors are JSON `{ msgs: string[], date, method, path }`. The gateway
 *    answers 403 "GTW-006: Token inválido." for a bad bearer token, and the
 *    Token API answers 401 with an empty body for a wrong user or access code.
 *
 * Every failure is a ToolError from @hay/plugin-sdk/tool-errors. Both calls are
 * safe to replay (the token call returns the token it already issued).
 */

const { toolError, codeForHttpStatus } = require("@hay/plugin-sdk/tool-errors");
const { toIso } = require("./dates");

const API_HOST = "https://api.correios.com.br";
const TIMEOUT_MS = 20000;
const RETRY_DELAY_MS = 400;
/** Ask for a new token this long before `expiraEm` ("alguns minutos antes"). */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function credentials() {
  const env = (name) => (process.env[name] || "").trim();
  const creds = {
    username: env("CORREIOS_USERNAME"),
    accessCode: env("CORREIOS_ACCESS_CODE"),
    postingCard: env("CORREIOS_POSTING_CARD"),
    contract: env("CORREIOS_CONTRACT"),
  };
  if (!creds.username || !creds.accessCode || (!creds.postingCard && !creds.contract)) {
    throw toolError(
      "INTERNAL",
      "The Correios connection is not configured (user, access code and a cartão de postagem " +
        "or contract number are required).",
    );
  }
  return creds;
}

/** Token endpoint + body for the credentials: by posting card when there is one, else by contract. */
function tokenRequest(creds) {
  if (creds.postingCard) {
    const body = { numero: creds.postingCard };
    if (creds.contract) body.contrato = creds.contract;
    return { path: "/token/v1/autentica/cartaopostagem", body };
  }
  return { path: "/token/v1/autentica/contrato", body: { numero: creds.contract } };
}

/** The human text of a Correios error body (`msgs`), or "". */
function correiosMessage(data) {
  const msgs = Array.isArray(data?.msgs) ? data.msgs.filter((m) => typeof m === "string") : [];
  return msgs.join(" ").trim().slice(0, 300);
}

/**
 * One HTTP call → `{ status, data }` (data is the parsed JSON body or null).
 * A network error, a 429 or a 5xx is retried once; a second network failure
 * throws PROVIDER_DOWN. HTTP error statuses are returned for the caller to map.
 */
async function request(method, path, { headers, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(API_HOST + path, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw toolError("PROVIDER_DOWN", "Correios did not respond. Try again in a moment.", {
        details: { path, cause: err?.message || String(err) },
      });
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON body (gateway HTML): the status alone drives the error.
    }
    return { status: response.status, data };
  }
}

const RECONNECT =
  "The store team has to fix the Correios connection in the plugin settings; until then " +
  "tracking is unavailable here.";

function tokenError(status, data, path) {
  const said = correiosMessage(data);
  const details = { path, status, ...(said ? { correiosMessage: said } : {}) };
  if (status === 401) {
    return toolError("AUTH_FAILED", `Correios rejected the user or API access code. ${RECONNECT}`, {
      details,
    });
  }
  if (status === 400 || status === 403) {
    return toolError(
      "AUTH_FAILED",
      "Correios refused to issue a token for this cartão de postagem / contract" +
        `${said ? ` (${said})` : ""}. ${RECONNECT}`,
      { details },
    );
  }
  const code = codeForHttpStatus(status, { idempotent: true });
  return toolError(code, "Correios could not issue an access token. Try again in a moment.", {
    details,
  });
}

/** `{ token, expiresAt }` of the current token, and the request that is fetching one. */
let cached = null;
let inflight = null;

async function fetchToken() {
  const creds = credentials();
  const { path, body } = tokenRequest(creds);
  const basic = Buffer.from(`${creds.username}:${creds.accessCode}`).toString("base64");
  const { status, data } = await request("POST", path, {
    headers: { Authorization: `Basic ${basic}` },
    body,
  });
  if (status < 200 || status >= 300) throw tokenError(status, data, path);
  if (typeof data?.token !== "string" || !data.token) {
    throw toolError("PROVIDER_DOWN", "Correios answered without an access token. Try again.", {
      details: { path, status },
    });
  }
  // An unreadable expiry means "do not reuse": the next call asks again, and
  // Correios hands back the same token while it is valid.
  const expiry = toIso(data.expiraEm, data.zoneOffset);
  cached = { token: data.token, expiresAt: expiry ? new Date(expiry).getTime() : 0 };
  return cached.token;
}

/** A valid bearer token: the cached one until shortly before it expires. */
async function getToken() {
  if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) return cached.token;
  if (!inflight) {
    inflight = fetchToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function resetTokenCache() {
  cached = null;
  inflight = null;
}

function rastroError(status, data, path) {
  const said = correiosMessage(data);
  const details = { path, status, ...(said ? { correiosMessage: said } : {}) };
  if (status === 401 || status === 403) {
    return toolError(
      status === 401 ? "AUTH_FAILED" : "SCOPE_MISSING",
      "Correios refused the tracking request: the store's contract or cartão de postagem is " +
        `not authorised for the tracking API (API Rastro)${said ? ` (${said})` : ""}. ${RECONNECT}`,
      { details },
    );
  }
  if (status === 429) {
    return toolError("RATE_LIMITED", "Correios is limiting requests. Try again in a moment.", {
      details,
    });
  }
  if (status >= 500) {
    return toolError("PROVIDER_DOWN", "Correios tracking is unavailable. Try again in a moment.", {
      details,
    });
  }
  return toolError(
    codeForHttpStatus(status, { idempotent: true }),
    `Correios refused the tracking request${said ? `: ${said}` : ` (HTTP ${status})`}.`,
    { details },
  );
}

/**
 * All tracking events of one object: the raw SRO response `{ objetos: [...] }`,
 * or null when Correios answers 404.
 * A rejected bearer token is dropped and the call repeated once with a new one.
 *
 * @param {string} code - a normalised 13-character tracking code
 */
async function fetchTracking(code) {
  const path = `/srorastro/v1/objetos/${encodeURIComponent(code)}?resultado=T`;
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const { status, data } = await request("GET", path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status >= 200 && status < 300) return data;
    // Unknown object: the tool explains it the same way as an empty answer.
    if (status === 404) return null;
    if ((status === 401 || status === 403) && attempt === 0) {
      resetTokenCache();
      continue;
    }
    throw rastroError(status, data, path);
  }
}

module.exports = { fetchTracking, getToken, resetTokenCache, tokenRequest, API_HOST };

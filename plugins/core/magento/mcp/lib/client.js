/**
 * Magento 2 REST API client (native `fetch`).
 *
 * Env (injected by the plugin worker, read at call time so tests can require
 * the module without credentials):
 *   MAGENTO_BASE_URL   e.g. https://store.example.com/rest/V1 (store-code
 *                      variants such as /rest/default/V1 also work)
 *   MAGENTO_API_TOKEN  integration access token (System → Integrations)
 *
 * Magento list endpoints take `searchCriteria[...]` query parameters; use
 * `searchCriteria()` to build them from a plain filter list.
 */

const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function credentials() {
  const baseUrl = (process.env.MAGENTO_BASE_URL || "").replace(/\/+$/, "");
  const token = process.env.MAGENTO_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("Magento MCP server is missing MAGENTO_BASE_URL or MAGENTO_API_TOKEN");
  }
  return { baseUrl, token };
}

/**
 * Call the Magento REST API; returns the parsed JSON body.
 *
 * @param {string} method
 * @param {string} path - Path under the base URL, e.g. "/orders/12".
 * @param {object} [options]
 * @param {Record<string,string>} [options.query] - Already-encoded key/value pairs.
 * @param {object} [options.body]
 */
async function magentoApi(method, path, { query, body } = {}) {
  const { baseUrl, token } = credentials();
  const url = new URL(baseUrl + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
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
      if (attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(Math.pow(2, attempt) * 250);
        continue;
      }
      throw new Error(`Magento API ${method} ${path} failed: ${err.message || String(err)}`);
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
      throw new MagentoApiError(method, path, response.status, text);
    }
    return text ? JSON.parse(text) : null;
  }
}

/**
 * Build `searchCriteria[...]` query params. `filters` is an array of
 * `{ field, value, condition }` (condition defaults to "eq"); each filter
 * becomes its own filter group, i.e. they are AND-ed.
 */
function searchCriteria(filters, { pageSize, currentPage, sortField, sortDirection } = {}) {
  const q = {};
  filters.forEach((f, i) => {
    q[`searchCriteria[filter_groups][${i}][filters][0][field]`] = f.field;
    q[`searchCriteria[filter_groups][${i}][filters][0][value]`] = String(f.value);
    q[`searchCriteria[filter_groups][${i}][filters][0][condition_type]`] = f.condition || "eq";
  });
  if (pageSize) q["searchCriteria[pageSize]"] = String(pageSize);
  if (currentPage) q["searchCriteria[currentPage]"] = String(currentPage);
  if (sortField) {
    q["searchCriteria[sortOrders][0][field]"] = sortField;
    q["searchCriteria[sortOrders][0][direction]"] = sortDirection || "DESC";
  }
  return q;
}

class MagentoApiError extends Error {
  constructor(method, path, status, rawBody) {
    super(`Magento API ${method} ${path} failed: HTTP ${status}: ${formatBody(rawBody)}`);
    this.name = "MagentoApiError";
    this.status = status;
  }
}

/** Magento errors: `{ message: "Text with %1", parameters: [..] | { key: val } }`. */
function formatBody(rawBody) {
  if (!rawBody) return "(empty response body)";
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return rawBody.slice(0, 400);
  }
  let message = typeof parsed?.message === "string" ? parsed.message : rawBody.slice(0, 400);
  const params = parsed?.parameters;
  if (Array.isArray(params)) {
    params.forEach((p, i) => {
      message = message.replace(new RegExp(`%${i + 1}\\b`, "g"), String(p));
    });
  } else if (params && typeof params === "object") {
    for (const [k, v] of Object.entries(params)) {
      message = message.replace(new RegExp(`%${k}\\b`, "g"), String(v));
    }
  }
  return message;
}

module.exports = { magentoApi, searchCriteria, MagentoApiError };

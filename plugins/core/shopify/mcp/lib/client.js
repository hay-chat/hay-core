/**
 * Shopify Admin GraphQL client for the Shopify MCP server.
 *
 * Credentials are injected by the plugin worker via env (both managed and
 * self-hosted modes resolve to the same three vars):
 *   SHOPIFY_SHOP          myshopify.com domain (e.g. mystore.myshopify.com)
 *   SHOPIFY_ACCESS_TOKEN  Admin API access token
 *   SHOPIFY_API_VERSION   Admin API version (e.g. 2026-04)
 *
 * Every failure is thrown as a ToolError from @hay/plugin-sdk/tool-errors, so
 * the agent gets a code (AUTH_FAILED, RATE_LIMITED, OUTCOME_UNKNOWN, ...) and a
 * retryable flag instead of raw HTTP text.
 */

const {
  toolError,
  codeForHttpStatus,
  codeForNetworkFailure,
} = require("@hay/plugin-sdk/tool-errors");

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True for a GraphQL mutation document (everything else is a read). */
function isMutation(query) {
  return /^\s*mutation\b/.test(query.replace(/^\s*#[^\n]*\n/gm, ""));
}

const OUTCOME_UNKNOWN_MESSAGE =
  "Shopify did not confirm whether this change went through. Check the order before trying again.";

/** Plain message for an HTTP failure that is not retried. */
function httpFailure(status, text, idempotent) {
  const details = { status, body: text.slice(0, 300) };
  // The GraphQL endpoint has no per-record 404: a 404 means the shop itself is
  // gone or the app was uninstalled, which is a connection problem.
  if (status === 401 || status === 404) {
    return toolError(
      "AUTH_FAILED",
      "Shopify rejected Hay.chat's access. The store needs to reconnect Shopify in Hay.chat.",
      { details },
    );
  }
  if (status === 402 || status === 423) {
    return toolError(
      "PROVIDER_REFUSED",
      "The Shopify store is unavailable (frozen, locked or unpaid).",
      { details },
    );
  }
  const code = codeForHttpStatus(status, { idempotent });
  if (code === "SCOPE_MISSING") {
    return toolError(
      code,
      "Hay.chat doesn't have permission for this in Shopify. The store needs to reconnect " +
        "Shopify in Hay.chat to grant it.",
      { details },
    );
  }
  if (code === "OUTCOME_UNKNOWN") return toolError(code, OUTCOME_UNKNOWN_MESSAGE, { details });
  return toolError(code, `Shopify returned HTTP ${status}.`, { details });
}

/** Classify GraphQL `errors` returned with HTTP 200. */
function graphqlFailure(errors, idempotent) {
  const codes = errors.map((e) => e && e.extensions && e.extensions.code).filter(Boolean);
  const messages = errors.map((e) => (e && e.message) || "").filter(Boolean);
  const details = { errors: errors.slice(0, 5) };
  if (codes.includes("ACCESS_DENIED")) {
    // Shopify's message names the missing scope (e.g. "Required access: `read_returns`").
    const missingScopes = [
      ...new Set(messages.flatMap((m) => m.match(/\b(?:read|write)_[a-z_]+\b/g) || [])),
    ];
    return toolError(
      "SCOPE_MISSING",
      "The store needs to re-approve Hay.chat in Shopify before Hay.chat can do this. Ask " +
        `the store owner to reconnect Shopify in Hay.chat. (${messages.join("; ")})`,
      { details: { ...details, missingScopes, reconnectRequired: true } },
    );
  }
  if (codes.includes("INTERNAL_SERVER_ERROR")) {
    return idempotent
      ? toolError("PROVIDER_DOWN", "Shopify had an internal error. Try again in a moment.", {
          details,
        })
      : toolError("OUTCOME_UNKNOWN", OUTCOME_UNKNOWN_MESSAGE, { details });
  }
  if (messages.some((m) => /invalid (global )?id|invalid value|was provided invalid/i.test(m))) {
    return toolError("BAD_INPUT", `Shopify rejected an id or value: ${messages.join("; ")}`, {
      details,
    });
  }
  return toolError("INTERNAL", `Shopify GraphQL error: ${messages.join("; ")}`, { details });
}

/**
 * Run a GraphQL operation against the Shopify Admin API.
 *
 * Retry policy, decided once per request: a THROTTLED / HTTP 429 response was
 * never executed, so any operation is retried. A network error, timeout or 5xx
 * may have been executed, so only queries are retried; a mutation fails with
 * OUTCOME_UNKNOWN instead of risking a double write.
 *
 * @param {string} query - GraphQL query or mutation
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<any>} the `data` object
 */
async function shopifyGql(query, variables = {}) {
  // Read at call time (not module load) so tests can require the module first.
  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
  if (!SHOP || !TOKEN) {
    throw toolError(
      "INTERNAL",
      "The Shopify connection is not configured (missing shop or access token).",
    );
  }

  const idempotent = !isMutation(query);
  const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

  for (let attempt = 1; ; attempt++) {
    const canRetry = attempt < MAX_ATTEMPTS;
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": TOKEN,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (idempotent && canRetry) {
        await sleep(attempt * 500);
        continue;
      }
      const code = codeForNetworkFailure({ idempotent });
      throw toolError(
        code,
        code === "OUTCOME_UNKNOWN"
          ? OUTCOME_UNKNOWN_MESSAGE
          : "Shopify did not respond. Try again in a moment.",
        { details: { cause: (err && err.message) || String(err) } },
      );
    }

    if (response.status === 429) {
      if (canRetry) {
        await sleep(attempt * 800);
        continue;
      }
      throw toolError("RATE_LIMITED", "Shopify is limiting requests right now. Try again shortly.");
    }

    if (response.status >= 500) {
      if (idempotent && canRetry) {
        await sleep(attempt * 800);
        continue;
      }
      throw idempotent
        ? toolError("PROVIDER_DOWN", "Shopify is having problems. Try again in a moment.", {
            details: { status: response.status },
          })
        : toolError("OUTCOME_UNKNOWN", OUTCOME_UNKNOWN_MESSAGE, {
            details: { status: response.status },
          });
    }

    if (!response.ok) {
      throw httpFailure(response.status, await response.text(), idempotent);
    }

    const json = await response.json();
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const throttled = json.errors.some(
        (e) => e && e.extensions && e.extensions.code === "THROTTLED",
      );
      if (throttled) {
        if (canRetry) {
          await sleep(attempt * 800);
          continue;
        }
        throw toolError(
          "RATE_LIMITED",
          "Shopify is limiting requests right now. Try again shortly.",
        );
      }
      throw graphqlFailure(json.errors, idempotent);
    }
    return json.data;
  }
}

module.exports = { shopifyGql, isMutation };

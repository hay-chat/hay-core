/**
 * Runtime check that the Shopify connection was granted the scopes a tool needs.
 *
 * Stores that connected before a scope was added to the manifest keep their old
 * grant until the merchant re-approves Hay.chat. Multi-step writes (order edits,
 * exchanges) call `requireScopes` first so a missing scope fails cleanly with
 * SCOPE_MISSING instead of leaving a half-finished edit behind.
 */

const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { shopifyGql } = require("./client");

const REAPPROVE_MESSAGE =
  "The store needs to re-approve Hay.chat in Shopify before Hay.chat can do this. " +
  "Ask the store owner to reconnect Shopify in Hay.chat to grant the new permissions.";

/** Granted scope handles for this process (the token does not change mid-process). */
let grantedCache = null;

async function grantedScopes() {
  if (grantedCache) return grantedCache;
  const data = await shopifyGql(
    `query AppScopes { currentAppInstallation { accessScopes { handle } } }`,
  );
  const handles = (data?.currentAppInstallation?.accessScopes || [])
    .map((s) => s && s.handle)
    .filter(Boolean);
  grantedCache = new Set(handles);
  return grantedCache;
}

/** A write_X grant implies read_X. */
function hasScope(granted, scope) {
  if (granted.has(scope)) return true;
  return scope.startsWith("read_") && granted.has(`write_${scope.slice(5)}`);
}

/** Throw SCOPE_MISSING (with `details.missingScopes`) unless every scope is granted. */
async function requireScopes(scopes) {
  const granted = await grantedScopes();
  const missing = scopes.filter((s) => !hasScope(granted, s));
  if (missing.length > 0) {
    throw toolError("SCOPE_MISSING", REAPPROVE_MESSAGE, {
      details: { missingScopes: missing, reconnectRequired: true },
    });
  }
}

/** Test hook: forget the cached grant. */
function resetScopeCache() {
  grantedCache = null;
}

module.exports = { requireScopes, hasScope, resetScopeCache, REAPPROVE_MESSAGE };

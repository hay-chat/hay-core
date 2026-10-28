/**
 * Shared error vocabulary for plugin MCP tools.
 *
 * A failed tool call returns `{ code, retryable, message, details? }` as its MCP
 * error text, so the agent (and later, core's action log) can tell a business
 * refusal ("already shipped") from an outage or a broken connection without
 * parsing prose.
 *
 * Plain CommonJS with no dependencies on purpose: local MCP servers are CommonJS
 * scripts spawned with `node`, and must be able to `require()` this on Node 20.
 * ESM code can `import` it too. Types live in ./index.d.ts.
 */

/**
 * Every code, whether a retry of the same call can help, and what it means.
 * `retryable` is the default for the code; a ToolError may override it.
 */
const TOOL_ERROR_CODES = Object.freeze({
  BAD_INPUT: {
    retryable: false,
    meaning: "The tool was called with missing or invalid arguments.",
  },
  NOT_FOUND: {
    retryable: false,
    meaning: "The order, customer or item does not exist in the store.",
  },
  PRECONDITION: {
    retryable: false,
    meaning: "A business rule refused the action (e.g. the order already shipped). Not an outage.",
  },
  PROVIDER_REFUSED: {
    retryable: false,
    meaning: "The platform rejected the request (validation or its own business rule).",
  },
  AUTH_FAILED: {
    retryable: false,
    meaning: "The store rejected the credentials (expired, revoked or wrong). Reconnect needed.",
  },
  SCOPE_MISSING: {
    retryable: false,
    meaning: "The connection lacks a permission this action needs. Reconnect with access.",
  },
  RATE_LIMITED: {
    retryable: true,
    meaning: "The platform is throttling requests. Retrying later can succeed.",
  },
  PROVIDER_DOWN: {
    retryable: true,
    meaning: "The platform failed or timed out on a read. Retrying later can succeed.",
  },
  OUTCOME_UNKNOWN: {
    retryable: false,
    meaning:
      "A write failed in a way that may still have been applied. Check the record before retrying.",
  },
  NEEDS_APPROVAL: {
    retryable: false,
    meaning:
      "Above the merchant's cap for this tool. Hay.chat core holds the call for a person's " +
      "approval when the tool declares capEnforced (see ../tool-risk); otherwise it is a refusal.",
  },
  INTERNAL: {
    retryable: false,
    meaning: "The plugin itself failed or is misconfigured.",
  },
});

class ToolError extends Error {
  /**
   * @param {keyof typeof TOOL_ERROR_CODES} code
   * @param {string} message - Plain, short; the agent may relay it.
   * @param {{ details?: object, retryable?: boolean, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    if (!Object.prototype.hasOwnProperty.call(TOOL_ERROR_CODES, code)) {
      throw new TypeError(`Unknown tool error code: ${code}`);
    }
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ToolError";
    this.code = code;
    this.retryable =
      typeof options.retryable === "boolean" ? options.retryable : TOOL_ERROR_CODES[code].retryable;
    if (options.details !== undefined) this.details = options.details;
  }

  toJSON() {
    const out = { code: this.code, retryable: this.retryable, message: this.message };
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

/** Shorthand for `new ToolError(code, message, options)`. */
function toolError(code, message, options) {
  return new ToolError(code, message, options);
}

/** True for a ToolError, including one created by another copy of this module. */
function isToolError(err) {
  return (
    err instanceof ToolError ||
    (!!err &&
      typeof err === "object" &&
      err.name === "ToolError" &&
      typeof err.code === "string" &&
      Object.prototype.hasOwnProperty.call(TOOL_ERROR_CODES, err.code))
  );
}

/** Coerce anything thrown into a ToolError (unknown errors become INTERNAL). */
function toToolError(err) {
  if (isToolError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ToolError("INTERNAL", message, { cause: err });
}

/**
 * Turn anything thrown inside a tool handler into an MCP error result whose text
 * is the JSON `{ code, retryable, message, details? }`.
 */
function toolErrorResult(err) {
  const e = toToolError(err);
  const payload = { code: e.code, retryable: e.retryable, message: e.message };
  if (e.details !== undefined) payload.details = e.details;
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Map a failed HTTP response to a code. Pass `idempotent: false` for writes: a 5xx
 * on a write may already have been applied, so it is OUTCOME_UNKNOWN rather than a
 * retryable PROVIDER_DOWN. Platform-specific bodies (e.g. "key is read-only")
 * should be checked by the caller first.
 *
 * @param {number} status
 * @param {{ idempotent: boolean }} options
 */
function codeForHttpStatus(status, { idempotent }) {
  if (status === 400 || status === 422) return "BAD_INPUT";
  if (status === 401) return "AUTH_FAILED";
  if (status === 403) return "SCOPE_MISSING";
  if (status === 404 || status === 410) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return idempotent ? "PROVIDER_DOWN" : "OUTCOME_UNKNOWN";
  return "PROVIDER_REFUSED";
}

/**
 * Code for a request that threw before any response (network error, timeout).
 * A write may have reached the store, so it is OUTCOME_UNKNOWN.
 */
function codeForNetworkFailure({ idempotent }) {
  return idempotent ? "PROVIDER_DOWN" : "OUTCOME_UNKNOWN";
}

module.exports = {
  TOOL_ERROR_CODES,
  ToolError,
  toolError,
  isToolError,
  toToolError,
  toolErrorResult,
  codeForHttpStatus,
  codeForNetworkFailure,
};

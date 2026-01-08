/**
 * Hay Plugin SDK - Logger Types
 *
 * Logger interface for plugin logging with multiple severity levels.
 *
 * @module @hay/plugin-sdk/types/logger
 */

/**
 * Logger interface for plugin logging.
 *
 * Provides structured logging with multiple severity levels.
 * Logs are automatically tagged with org and plugin context.
 *
 * @remarks
 * The logger outputs to stdout/stderr which is captured by the worker runner.
 * Log messages are automatically prefixed with context (e.g., `[org:abc123][plugin:stripe]`).
 *
 * **Available log levels**:
 * - `debug`: Detailed diagnostic information (development/debugging)
 * - `info`: Informational messages about normal operation
 * - `warn`: Warning messages about potential issues
 * - `error`: Error messages about failures
 *
 * @example
 * ```typescript
 * logger.info("Stripe MCP server started");
 * logger.warn("API rate limit approaching", { remaining: 10 });
 * logger.error("Failed to validate credentials", { error: err.message });
 * logger.debug("Config values loaded", { fields: Object.keys(config) });
 * ```
 *
 * @see PLUGIN.md Section 5.3.5 (lines 567-577)
 */
export interface HayLogger {
  /**
   * Log debug-level message.
   *
   * Use for detailed diagnostic information useful during development.
   *
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  debug(message: string, meta?: any): void;

  /**
   * Log info-level message.
   *
   * Use for informational messages about normal operation.
   *
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  info(message: string, meta?: any): void;

  /**
   * Log warning-level message.
   *
   * Use for warning messages about potential issues that don't prevent operation.
   *
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  warn(message: string, meta?: any): void;

  /**
   * Log error-level message.
   *
   * Use for error messages about failures or exceptions.
   *
   * @param message - Log message
   * @param meta - Optional metadata object (e.g., error details, stack trace)
   */
  error(message: string, meta?: any): void;
}

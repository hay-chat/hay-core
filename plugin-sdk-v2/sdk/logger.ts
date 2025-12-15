/**
 * Hay Plugin SDK v2 - Logger Implementation
 *
 * Logger implementation with context tagging and structured output.
 *
 * @module @hay/plugin-sdk-v2/sdk/logger
 */

import type { HayLogger } from '../types/index.js';

/**
 * Log level enumeration.
 *
 * @internal
 */
enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Logger context for tagging log messages.
 *
 * @remarks
 * Context tags are prepended to log messages in the format:
 * `[org:orgId][plugin:pluginId]`
 */
export interface LoggerContext {
  /**
   * Organization ID (optional).
   * If provided, logs will include `[org:xxx]` tag.
   */
  orgId?: string;

  /**
   * Plugin ID/name (optional).
   * If provided, logs will include `[plugin:xxx]` tag.
   */
  pluginId?: string;
}

/**
 * Logger implementation for Hay plugins.
 *
 * Provides structured logging with context tagging and metadata support.
 *
 * @remarks
 * The logger outputs to stdout (debug, info) and stderr (warn, error).
 * All log messages are formatted consistently with:
 * - Timestamp (ISO 8601)
 * - Context tags ([org:xxx][plugin:yyy])
 * - Log level
 * - Message
 * - Metadata (if provided, as JSON)
 *
 * **Output format**:
 * ```
 * [2024-01-15T10:30:45.123Z] [org:abc123][plugin:stripe] INFO: Plugin started
 * [2024-01-15T10:30:45.456Z] [org:abc123][plugin:stripe] ERROR: Auth failed {"reason":"invalid_key"}
 * ```
 *
 * @example
 * ```typescript
 * const logger = new Logger({ orgId: 'org-123', pluginId: 'stripe' });
 *
 * logger.info('Plugin started');
 * logger.warn('Rate limit approaching', { remaining: 10 });
 * logger.error('Operation failed', { error: err.message, code: 500 });
 * logger.debug('Config loaded', { fields: ['apiKey', 'maxRetries'] });
 * ```
 */
export class Logger implements HayLogger {
  private readonly context: LoggerContext;

  /**
   * Create a new logger instance.
   *
   * @param context - Logger context with org and plugin IDs
   */
  constructor(context: LoggerContext = {}) {
    this.context = context;
  }

  /**
   * Log debug-level message.
   *
   * Use for detailed diagnostic information useful during development.
   * Outputs to stdout.
   *
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * Log info-level message.
   *
   * Use for informational messages about normal operation.
   * Outputs to stdout.
   *
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * Log warning-level message.
   *
   * Use for warning messages about potential issues that don't prevent operation.
   * Outputs to stderr.
   *
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  warn(message: string, meta?: any): void {
    this.log(LogLevel.WARN, message, meta);
  }

  /**
   * Log error-level message.
   *
   * Use for error messages about failures or exceptions.
   * Outputs to stderr.
   *
   * @param message - Log message
   * @param meta - Optional metadata object (e.g., error details, stack trace)
   */
  error(message: string, meta?: any): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * Internal log method.
   *
   * Formats and outputs log message with context and metadata.
   *
   * @param level - Log level
   * @param message - Log message
   * @param meta - Optional metadata
   *
   * @internal
   */
  private log(level: LogLevel, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const contextTag = this.formatContext();
    const metaString = meta !== undefined ? ' ' + this.formatMeta(meta) : '';

    const logMessage = `[${timestamp}]${contextTag} ${level}: ${message}${metaString}`;

    // Output to stdout for debug/info, stderr for warn/error
    if (level === LogLevel.DEBUG || level === LogLevel.INFO) {
      console.log(logMessage);
    } else {
      console.error(logMessage);
    }
  }

  /**
   * Format context tags.
   *
   * @returns Formatted context string (e.g., " [org:abc][plugin:xyz]")
   *
   * @internal
   */
  private formatContext(): string {
    const tags: string[] = [];

    if (this.context.orgId) {
      tags.push(`[org:${this.context.orgId}]`);
    }

    if (this.context.pluginId) {
      tags.push(`[plugin:${this.context.pluginId}]`);
    }

    return tags.length > 0 ? ' ' + tags.join('') : '';
  }

  /**
   * Format metadata as JSON string.
   *
   * @param meta - Metadata object
   * @returns JSON string
   *
   * @internal
   */
  private formatMeta(meta: any): string {
    try {
      // Handle Error objects specially
      if (meta instanceof Error) {
        return JSON.stringify({
          message: meta.message,
          name: meta.name,
          stack: meta.stack,
        });
      }

      // Handle other objects
      return JSON.stringify(meta);
    } catch (err) {
      // Fallback for circular references or other JSON errors
      return String(meta);
    }
  }

  /**
   * Create a child logger with updated context.
   *
   * Useful for creating scoped loggers with additional context.
   *
   * @param additionalContext - Additional context to merge with current context
   * @returns New logger instance with merged context
   *
   * @example
   * ```typescript
   * const baseLogger = new Logger({ pluginId: 'stripe' });
   * const orgLogger = baseLogger.child({ orgId: 'org-123' });
   *
   * orgLogger.info('Processing for specific org');
   * // Output: [timestamp] [org:org-123][plugin:stripe] INFO: Processing for specific org
   * ```
   */
  child(additionalContext: LoggerContext): Logger {
    return new Logger({
      ...this.context,
      ...additionalContext,
    });
  }
}

/**
 * Create a logger instance with context.
 *
 * Convenience function for creating loggers.
 *
 * @param context - Logger context with org and plugin IDs
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({ orgId: 'org-123', pluginId: 'stripe' });
 * logger.info('Plugin initialized');
 * ```
 */
export function createLogger(context: LoggerContext = {}): HayLogger {
  return new Logger(context);
}

/**
 * Centralized Logger
 *
 * Structured logging with automatic PII redaction.
 * Uses Pino for high-performance JSON logging in production
 * and human-readable output in development.
 *
 * Usage:
 * ```typescript
 * import { createLogger } from "@server/lib/logger";
 * const logger = createLogger("my-module");
 *
 * logger.info("Operation completed", { userId: "123", duration: 45 });
 * logger.error({ err: error }, "Operation failed");
 * logger.warn("Deprecation notice");
 * logger.debug("Detailed trace info");
 * ```
 */

import pino from "pino";
import { config } from "@server/config/env";
import { REDACT_PATHS, REDACT_CENSOR, redactString } from "./redaction";

const level = config.logging.level || (config.isProduction ? "info" : "debug");

function buildTransport(): pino.TransportSingleOptions | undefined {
  // In production or test, use default JSON to stdout (no transport needed)
  if (config.isProduction || config.isTest) {
    return undefined;
  }

  // Development: human-readable with colors
  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

const transport = buildTransport();

const rootLogger = pino({
  level,
  redact: {
    paths: REDACT_PATHS,
    censor: REDACT_CENSOR,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact PII from string messages
  hooks: {
    logMethod(this: pino.Logger, inputArgs, method) {
      // Pino's logMethod receives args in the form:
      // (obj, msg, ...args) or (msg, ...args)
      if (typeof inputArgs[0] === "string") {
        inputArgs[0] = redactString(inputArgs[0]);
      } else if (inputArgs.length >= 2 && typeof inputArgs[1] === "string") {
        inputArgs[1] = redactString(inputArgs[1]);
      }
      return method.apply(this, inputArgs as Parameters<typeof method>);
    },
  },
  ...(transport ? { transport } : {}),
});

/**
 * Create a child logger scoped to a module.
 * The module name appears in every log line for easy filtering.
 */
export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}

/**
 * Root logger instance. Prefer createLogger(module) for module-scoped logging.
 */
export const logger = rootLogger;

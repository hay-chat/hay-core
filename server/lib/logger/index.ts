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

/**
 * Parse DEBUG_MODULES env var.
 *
 * - Unset or "*" → all modules emit at the root level (no filtering)
 * - "perception,retrieval" → only those modules emit debug; others floor at info
 * - "!noisy,other" → exclude "noisy" from debug, allow everything else
 */
function parseDebugModules(input: string | undefined): {
  include: string[];
  exclude: string[];
  active: boolean;
} {
  if (!input || input.trim() === "" || input.trim() === "*") {
    return { include: [], exclude: [], active: false };
  }
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of input.split(",")) {
    const mod = raw.trim().toLowerCase();
    if (!mod || mod === "*") continue;
    if (mod.startsWith("!")) exclude.push(mod.substring(1));
    else include.push(mod);
  }
  return { include, exclude, active: include.length > 0 || exclude.length > 0 };
}

const debugModules = parseDebugModules(process.env.DEBUG_MODULES);

function levelForModule(moduleName: string): string {
  if (!debugModules.active) return level;
  const m = moduleName.toLowerCase();
  if (debugModules.exclude.includes(m)) {
    // Excluded: raise floor above debug
    return level === "trace" || level === "debug" ? "info" : level;
  }
  if (debugModules.include.length > 0 && !debugModules.include.includes(m)) {
    // Filter is set and module isn't in it: raise floor above debug
    return level === "trace" || level === "debug" ? "info" : level;
  }
  return level;
}

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
  // Redact PII from string messages (including printf-style %s arguments)
  hooks: {
    logMethod(this: pino.Logger, inputArgs, method) {
      for (let i = 0; i < inputArgs.length; i++) {
        if (typeof inputArgs[i] === "string") {
          (inputArgs as string[])[i] = redactString(inputArgs[i] as string);
        }
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
  return rootLogger.child({ module }, { level: levelForModule(module) });
}

/**
 * Root logger instance. Prefer createLogger(module) for module-scoped logging.
 */
export const logger = rootLogger;

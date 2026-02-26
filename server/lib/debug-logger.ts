import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import type pino from "pino";

/**
 * Debug Logger Utility (Legacy Bridge)
 *
 * @deprecated Use `createLogger(module)` from `@server/lib/logger` instead.
 *
 * This module now delegates to the centralized Pino-based logger with PII redaction.
 * It preserves the DEBUG_MODULES filtering behavior for backwards compatibility.
 *
 * Migration:
 * ```typescript
 * // Before:
 * import { debugLog } from "@server/lib/debug-logger";
 * debugLog("perception", "Analyzing intent", { messageId: "123" });
 *
 * // After:
 * import { createLogger } from "@server/lib/logger";
 * const logger = createLogger("perception");
 * logger.info({ messageId: "123" }, "Analyzing intent");
 * ```
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogOptions {
  level?: LogLevel;
  data?: unknown;
}

// Parse DEBUG_MODULES environment variable
const debugModulesEnv = process.env.DEBUG_MODULES || "*";
const debugModulesConfig = parseDebugModules(debugModulesEnv);

function parseDebugModules(input: string): { include: string[]; exclude: string[] } {
  const modules = input.split(",").map((m) => m.trim().toLowerCase());
  const include: string[] = [];
  const exclude: string[] = [];

  for (const mod of modules) {
    if (mod.startsWith("!")) {
      exclude.push(mod.substring(1));
    } else if (mod !== "*" && mod !== "") {
      include.push(mod);
    }
  }

  return { include, exclude };
}

function shouldLogModule(moduleName: string): boolean {
  const moduleLower = moduleName.toLowerCase();
  const { include, exclude } = debugModulesConfig;

  if (exclude.includes(moduleLower)) {
    return false;
  }

  if (include.length === 0) {
    return true;
  }

  return include.includes(moduleLower);
}

// Cache child loggers per module to avoid re-creation
const loggerCache = new Map<string, pino.Logger>();

function getModuleLogger(moduleName: string): pino.Logger {
  let cached = loggerCache.get(moduleName);
  if (!cached) {
    cached = createLogger(moduleName);
    loggerCache.set(moduleName, cached);
  }
  return cached;
}

/**
 * @deprecated Use `createLogger(module)` from `@server/lib/logger` instead.
 */
export function debugLog(moduleName: string, message: string, options?: LogOptions | unknown): void {
  const debugModulesSet = process.env.DEBUG_MODULES && process.env.DEBUG_MODULES !== "*";
  const debugEnabled = config.logging.debug || debugModulesSet;

  if (!debugEnabled) {
    return;
  }

  if (!shouldLogModule(moduleName)) {
    return;
  }

  const logger = getModuleLogger(moduleName);

  const opts = options as LogOptions | Record<string, unknown> | undefined;
  const level: LogLevel =
    (opts && typeof opts === "object" && "level" in opts ? (opts.level as LogLevel) : "debug") || "debug";
  const data =
    opts && typeof opts === "object" && "data" in opts
      ? opts.data
      : opts && typeof opts === "object" && !("level" in opts)
        ? opts
        : undefined;

  if (data && typeof data === "object") {
    logger[level](data as object, message);
  } else {
    logger[level](message);
  }
}

import { config } from "@server/config/env";

/**
 * Debug Logger Utility
 *
 * Provides conditional logging based on the DEBUG and DEBUG_MODULES environment variables.
 *
 * If DEBUG_MODULES is set to anything other than "*", debug logging is automatically enabled
 * (you don't need DEBUG=true). This allows you to see only your app's debug logs without
 * enabling DEBUG for all Node.js modules (like OpenAI SDK).
 *
 * You can filter specific modules using DEBUG_MODULES environment variable:
 * - DEBUG_MODULES="perception,retrieval" - Only show these modules (auto-enables debugging)
 * - DEBUG_MODULES="*" - Show all modules (requires DEBUG=true)
 * - DEBUG_MODULES="!redis,!websocket" - Show all EXCEPT these modules (auto-enables debugging)
 *
 * Usage:
 * ```typescript
 * import { debugLog } from "@server/lib/debug-logger";
 *
 * debugLog("perception", "Analyzing message intent", { messageId: "123" });
 * ```
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogOptions {
  level?: LogLevel;
  data?: any;
}

// Parse DEBUG_MODULES environment variable
const debugModulesEnv = process.env.DEBUG_MODULES || "*";
const debugModulesConfig = parseDebugModules(debugModulesEnv);

function parseDebugModules(input: string): { include: string[]; exclude: string[] } {
  const modules = input.split(",").map((m) => m.trim().toLowerCase());
  const include: string[] = [];
  const exclude: string[] = [];

  for (const module of modules) {
    if (module.startsWith("!")) {
      exclude.push(module.substring(1));
    } else if (module !== "*" && module !== "") {
      include.push(module);
    }
  }

  return { include, exclude };
}

function shouldLogModule(module: string): boolean {
  const moduleLower = module.toLowerCase();
  const { include, exclude } = debugModulesConfig;

  // If module is in exclude list, don't log it
  if (exclude.includes(moduleLower)) {
    return false;
  }

  // If include list is empty (meaning "*" or no filter), log everything not excluded
  if (include.length === 0) {
    return true;
  }

  // If include list has items, only log if module is in the list
  return include.includes(moduleLower);
}

/**
 * Main debug logging function
 * @param module - The module/component name (e.g., "perception", "retrieval", "execution")
 * @param message - The log message
 * @param options - Optional configuration including log level and additional data
 */
export function debugLog(module: string, message: string, options?: LogOptions | any): void {
  // If DEBUG_MODULES is set (not default "*"), enable debug logging automatically
  // This allows selective debugging without enabling DEBUG for all Node.js modules
  const debugModulesSet = process.env.DEBUG_MODULES && process.env.DEBUG_MODULES !== "*";
  const debugEnabled = config.logging.debug || debugModulesSet;

  if (!debugEnabled) {
    return;
  }

  // Check if this module should be logged
  if (!shouldLogModule(module)) {
    return;
  }

  const level = options?.level || "debug";
  const data =
    options?.data ||
    (options && typeof options === "object" && !options.level ? options : undefined);

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${module.toUpperCase()}]`;

  const logMessage = data
    ? `${prefix} ${message} | Data: ${JSON.stringify(data, null, 2)}`
    : `${prefix} ${message}`;

  switch (level) {
    case "error":
      console.error(logMessage);
      break;
    case "warn":
      console.warn(logMessage);
      break;
    case "info":
      console.info(logMessage);
      break;
    case "debug":
    default:
      console.log(logMessage);
      break;
  }
}

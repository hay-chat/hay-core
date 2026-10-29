/**
 * Argument parsing for the hay CLI. Pure functions, no I/O.
 */

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** Flags that never take a value. Everything else consumes the next token. */
export const BOOLEAN_FLAGS = new Set(["json", "wait", "no-wait", "logs", "help", "all", "verbose"]);

export class UsageError extends Error {}

/**
 * Parse argv (without the node/script entries).
 * Supports `--flag value`, `--flag=value`, boolean flags, `-h`, and `--` to end flags.
 */
export function parseArgs(argv: string[], booleanFlags: Set<string> = BOOLEAN_FLAGS): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h") {
      flags.help = true;
      continue;
    }
    if (!token.startsWith("--") || token === "--") {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (booleanFlags.has(body)) {
      flags[body] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith("--") && next !== "--")) {
      throw new UsageError(`--${body} needs a value`);
    }
    flags[body] = next;
    i++;
  }

  return { positionals, flags };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new UsageError(`--${name} needs a value`);
  return value;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name];
  return value === true || value === "true" || value === "1";
}

export function intFlag(args: ParsedArgs, name: string, fallback: number): number {
  const raw = stringFlag(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`--${name} must be a positive integer`);
  }
  return value;
}

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** "90s", "5m", "2h", "1d", "500ms" or bare seconds ("30") to milliseconds. */
export function parseDuration(input: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(input.trim());
  if (!match) throw new UsageError(`Invalid duration "${input}" (use e.g. 30s, 5m, 2h)`);
  const unit = match[2] ?? "s";
  return Math.round(Number(match[1]) * DURATION_UNITS[unit]);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

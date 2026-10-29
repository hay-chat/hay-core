/**
 * Server log access and filtering. Prod logs are pino JSON lines from
 * `docker logs`; a local dev server prints pino-pretty text, which the CLI can
 * read from a file (`HAY_LOCAL_LOG_FILE`, e.g. `npm run dev:server | tee`).
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { LogSource } from "./config";

export interface LogEntry {
  raw: string;
  time?: string;
  level?: string;
  module?: string;
  msg?: string;
  fields?: Record<string, unknown>;
}

export interface LogFilter {
  conversationId?: string;
  sinceMs?: number;
  /** Keep only the last N matching entries. */
  limit?: number;
}

const LEVELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const NOISE_KEYS = new Set(["level", "time", "pid", "hostname", "module", "msg"]);
const PRETTY_TIME_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)(?: ([+-]\d{4}))?\]/;

/**
 * Split raw log text into entries. Lines that start with whitespace continue the
 * previous entry (pino-pretty prints fields and stacks on indented lines).
 */
export function splitEntries(text: string): string[] {
  const entries: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && entries.length > 0) {
      entries[entries.length - 1] += `\n${line}`;
    } else {
      entries.push(line);
    }
  }
  return entries;
}

export function parseEntry(raw: string): LogEntry {
  if (raw.startsWith("{")) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(json)) {
        if (!NOISE_KEYS.has(key)) fields[key] = value;
      }
      return {
        raw,
        time: typeof json.time === "string" ? json.time : undefined,
        level:
          typeof json.level === "number" ? (LEVELS[json.level] ?? String(json.level)) : undefined,
        module: typeof json.module === "string" ? json.module : undefined,
        msg: typeof json.msg === "string" ? json.msg : undefined,
        fields,
      };
    } catch {
      // Not JSON after all; fall through to text handling.
    }
  }
  const pretty = PRETTY_TIME_RE.exec(raw);
  if (pretty) {
    const offset = pretty[2] ? `${pretty[2].slice(0, 3)}:${pretty[2].slice(3)}` : "";
    const date = new Date(`${pretty[1].replace(" ", "T")}${offset}`);
    if (!Number.isNaN(date.getTime())) return { raw, time: date.toISOString() };
  }
  return { raw };
}

export function filterEntries(entries: LogEntry[], filter: LogFilter): LogEntry[] {
  const matched = entries.filter((entry) => {
    if (filter.conversationId && !entry.raw.includes(filter.conversationId)) return false;
    if (filter.sinceMs !== undefined && entry.time) {
      if (new Date(entry.time).getTime() < filter.sinceMs) return false;
    }
    return true;
  });
  return filter.limit ? matched.slice(-filter.limit) : matched;
}

function compactValue(value: unknown, max: number): string {
  if (value && typeof value === "object" && "message" in value) {
    const err = value as { type?: string; message?: unknown };
    return `${err.type ?? "Error"}: ${String(err.message)}`.slice(0, max);
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One line per entry: `HH:MM:SS.mmm LEVEL module msg key=value ...`.
 * `omit` drops fields that are implied by the query (e.g. the conversation id).
 */
export function formatEntry(
  entry: LogEntry,
  options: { omit?: string[]; verbose?: boolean } = {},
): string {
  if (!entry.fields) return entry.raw;
  const time = entry.time ? entry.time.slice(11, 23) : "";
  const omit = new Set(options.omit ?? []);
  const max = options.verbose ? 2000 : 120;
  const extras = Object.entries(entry.fields)
    .filter(([key, value]) => !omit.has(key) && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${compactValue(value, max)}`)
    .join(" ");
  const line = [time, entry.level, entry.module, entry.msg, extras].filter(Boolean).join(" ");
  return options.verbose || line.length <= 400 ? line : `${line.slice(0, 399)}…`;
}

/** Read raw log text from the target's log source, starting at `sinceMs`. */
export async function readLogSource(source: LogSource, sinceMs: number): Promise<string> {
  if (source.type === "file") {
    return readFile(source.path, "utf8");
  }
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["logs", "--since", new Date(sinceMs).toISOString(), source.container],
      { maxBuffer: 512 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`docker logs ${source.container} failed: ${stderr || error.message}`));
          return;
        }
        // Pino writes everything to stdout; stderr carries crashes and npm noise.
        resolve(`${stdout}\n${stderr}`);
      },
    );
  });
}

export async function fetchLogs(source: LogSource, filter: LogFilter): Promise<LogEntry[]> {
  const sinceMs = filter.sinceMs ?? Date.now() - 15 * 60_000;
  const text = await readLogSource(source, sinceMs);
  const entries = splitEntries(text).map(parseEntry);
  return filterEntries(entries, { ...filter, sinceMs });
}

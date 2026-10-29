/**
 * CLI configuration and per-conversation webchat keys, stored outside the repo
 * in ~/.config/hay-cli/ (override with HAY_CLI_CONFIG_DIR). Files are mode 600.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LogSource = { type: "docker"; container: string } | { type: "file"; path: string };

export interface TargetProfile {
  baseUrl: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Org-scoped API key (`hay_...`), used instead of the JWT when set. */
  apiKey?: string;
  organizationId?: string;
  organizationName?: string;
  logSource?: LogSource;
}

export interface CliConfig {
  defaultTarget?: string;
  targets: Record<string, TargetProfile>;
}

export interface ConversationKeys {
  target: string;
  organizationId: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  nonce: string;
  createdAt: string;
}

type ConversationStore = Record<string, ConversationKeys>;

const MAX_STORED_CONVERSATIONS = 200;

export const BUILTIN_TARGETS: Record<string, TargetProfile> = {
  local: { baseUrl: "http://localhost:3001" },
  prod: { baseUrl: "https://eu.hay.chat", logSource: { type: "docker", container: "hay-server" } },
};

export function configDir(): string {
  return process.env.HAY_CLI_CONFIG_DIR || join(homedir(), ".config", "hay-cli");
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Could not read ${path}: ${(error as Error).message}`);
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

export function loadConfig(): CliConfig {
  const config = readJson<CliConfig>(join(configDir(), "config.json"), { targets: {} });
  config.targets ??= {};
  return config;
}

export function saveConfig(config: CliConfig): void {
  writeJson(join(configDir(), "config.json"), config);
}

/** Target name from --target, then HAY_TARGET, then the config default, then prod. */
export function resolveTargetName(flag: string | undefined, config: CliConfig): string {
  return flag || process.env.HAY_TARGET || config.defaultTarget || "prod";
}

/** The stored profile merged over the built-in defaults for that target. */
export function resolveProfile(name: string, config: CliConfig): TargetProfile {
  const builtin = BUILTIN_TARGETS[name];
  const stored = config.targets[name];
  if (!builtin && !stored) {
    throw new Error(
      `Unknown target "${name}". Built-in: ${Object.keys(BUILTIN_TARGETS).join(", ")}; ` +
        `add others under "targets" in ${join(configDir(), "config.json")}`,
    );
  }
  const profile: TargetProfile = { ...builtin, ...stored } as TargetProfile;
  if (name === "local" && !profile.logSource && process.env.HAY_LOCAL_LOG_FILE) {
    profile.logSource = { type: "file", path: process.env.HAY_LOCAL_LOG_FILE };
  }
  return profile;
}

export function updateProfile(name: string, patch: Partial<TargetProfile>): void {
  const config = loadConfig();
  const current = config.targets[name] ?? { baseUrl: BUILTIN_TARGETS[name]?.baseUrl ?? "" };
  config.targets[name] = { ...current, ...patch };
  saveConfig(config);
}

const conversationsPath = (): string => join(configDir(), "conversations.json");

export function loadConversationKeys(conversationId: string): ConversationKeys | undefined {
  return readJson<ConversationStore>(conversationsPath(), {})[conversationId];
}

export function saveConversationKeys(conversationId: string, keys: ConversationKeys): void {
  const store = readJson<ConversationStore>(conversationsPath(), {});
  store[conversationId] = keys;
  const ids = Object.keys(store).sort((a, b) => (store[a].createdAt < store[b].createdAt ? 1 : -1));
  for (const id of ids.slice(MAX_STORED_CONVERSATIONS)) delete store[id];
  writeJson(conversationsPath(), store);
}

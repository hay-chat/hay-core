/**
 * Hay Plugin SDK - Plugin State Types
 *
 * A small key/value store a plugin worker keeps across restarts, scoped by core
 * to this organization and plugin. Values are JSON and encrypted at rest, so a
 * flow can park short-lived credentials between steps. Not a database: at most
 * a few hundred keys of up to 64 KB each.
 *
 * @module @hay/plugin-sdk/types/state
 */

export interface HayPluginStateSetOptions {
  /** Forget the key after this many milliseconds (max 90 days). */
  ttlMs?: number;
}

export interface HayPluginStateAPI {
  /** The stored value, or null when missing or expired. */
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: HayPluginStateSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Hay Plugin SDK - Credential store
 *
 * A worker starts with its organization's non-secret settings only. The secrets
 * its manifest declares (`hay-plugin.credentials`) are pulled from core over the
 * plugin API with the worker's token, and kept in memory, never in the environment.
 * Core refreshes a connected account's access token when it is pulled, so the store
 * pulls again before the token it holds expires.
 *
 * The store fills the same config map and auth state that `ctx.config` and
 * `ctx.auth` read, in place, so plugin code reads secrets the way it reads any
 * other setting.
 *
 * @module @hay/plugin-sdk/sdk/credential-store
 */

import type { AuthState, HayLogger } from "../types/index.js";

export interface CredentialDeclaration {
  /** A secret config field's key, or "auth" for the connected account's credentials. */
  name: string;
  source: "config" | "auth";
  /** Capability core requires the worker to hold. */
  capability: string;
  hosts?: Array<string | { fromConfig: string; suffix?: string }>;
}

export interface CredentialStoreOptions {
  declarations: CredentialDeclaration[];
  /** Non-secret settings the worker started with. */
  settings: Record<string, unknown>;
  /** Method id of the connected account, or null when none is configured. */
  authMethodId: string | null;
  apiUrl: string;
  apiToken: string;
  logger: HayLogger;
  fetchImpl?: typeof fetch;
  /** Epoch milliseconds; replaceable in tests. */
  now?: () => number;
}

/** Pull again this long before an access token expires. */
const EXPIRY_MARGIN_SECONDS = 120;
/** Pull again at least this often while the worker handles requests. */
const MAX_AGE_MS = 60_000;
/** A pull that takes longer is abandoned, so a stuck core cannot stall requests. */
const PULL_TIMEOUT_MS = 5_000;

interface Entry {
  value: unknown;
  expiresAt: number | null;
  fetchedAt: number;
}

export class CredentialStore {
  /** The map `ctx.config` reads; updated in place. */
  readonly config: Record<string, any>;
  /** The state `ctx.auth` reads; null when the organization has no connected account. */
  readonly authState: AuthState | null;

  private readonly entries = new Map<string, Entry>();
  /** The refresh in progress; requests that arrive meanwhile wait for it instead of pulling again. */
  private staleRefresh: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: CredentialStoreOptions) {
    this.config = { ...options.settings };
    this.authState = options.authMethodId
      ? { methodId: options.authMethodId, credentials: {} }
      : null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** Pull every declared credential. Rejects when core refuses one. */
  async refreshAll(): Promise<void> {
    await Promise.all(this.options.declarations.map((declaration) => this.pull(declaration)));
    this.apply();
  }

  /** Pull the credentials that are about to expire or have not been pulled for a minute. */
  refreshStale(): Promise<void> {
    this.staleRefresh ??= this.pullStale().finally(() => {
      this.staleRefresh = null;
    });
    return this.staleRefresh;
  }

  private async pullStale(): Promise<void> {
    const now = this.now();
    const stale = this.options.declarations.filter((declaration) => {
      const entry = this.entries.get(declaration.name);
      if (!entry) return true;
      if (entry.expiresAt !== null && entry.expiresAt - EXPIRY_MARGIN_SECONDS <= now / 1000) {
        return true;
      }
      return now - entry.fetchedAt >= MAX_AGE_MS;
    });
    if (stale.length === 0) return;
    try {
      await Promise.all(stale.map((declaration) => this.pull(declaration)));
      this.apply();
    } catch (error) {
      // Keep working with what the worker holds; the next request tries again.
      this.options.logger.warn("Could not refresh credentials", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async pull(declaration: CredentialDeclaration): Promise<void> {
    const response = await this.fetchImpl(
      `${this.options.apiUrl.replace(/\/$/, "")}/v1/pluginApi.credentials.get`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiToken}`,
        },
        body: JSON.stringify({ name: declaration.name }),
        signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`Core refused credential "${declaration.name}" (${response.status})`);
    }
    const body = (await response.json()) as {
      result?: { data?: { value?: unknown; expiresAt?: number | null } };
    };
    const data = body.result?.data;
    this.entries.set(declaration.name, {
      value: data?.value ?? null,
      expiresAt: typeof data?.expiresAt === "number" ? data.expiresAt : null,
      fetchedAt: this.now(),
    });
  }

  /** Rebuild the shared config map and auth state from what has been pulled. */
  private apply(): void {
    const next: Record<string, unknown> = { ...this.options.settings };
    for (const declaration of this.options.declarations) {
      const entry = this.entries.get(declaration.name);
      if (!entry || declaration.source !== "auth") continue;
      if (entry.value === null || entry.value === undefined) {
        // The account was disconnected: nothing from the earlier pull remains.
        if (this.authState) this.authState.credentials = {};
        continue;
      }
      const credentials = entry.value as Record<string, unknown>;
      if (this.authState) this.authState.credentials = { ...credentials };
      // The connected account's credentials are also readable as config fields.
      Object.assign(next, credentials);
    }
    for (const declaration of this.options.declarations) {
      const entry = this.entries.get(declaration.name);
      if (declaration.source === "config" && entry && entry.value !== null) {
        next[declaration.name] = entry.value;
      }
    }
    for (const key of Object.keys(this.config)) {
      if (!(key in next)) delete this.config[key];
    }
    Object.assign(this.config, next);
  }
}

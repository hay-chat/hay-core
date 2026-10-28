/**
 * Session refresh policy (D11-4): the dashboard logs the user out only when
 * the server definitively rejects the refresh token. Network errors, timeouts,
 * 5xx and offline never end the session; the refresh is retried with backoff
 * and again when the network comes back.
 *
 * Kept free of Nuxt/Pinia so it can be unit tested.
 */

/** No refresh token left (e.g. another tab logged out). Definitive. */
export class SessionEndedError extends Error {
  constructor() {
    super("Session ended");
    this.name = "SessionEndedError";
  }
}

/** The refresh could not reach a verdict (offline, timeout, 5xx). The session is kept. */
export class SessionRefreshUnavailableError extends Error {
  constructor(public readonly lastError?: unknown) {
    super("Could not refresh the session right now");
    this.name = "SessionRefreshUnavailableError";
  }
}

interface ErrorWithTrpcData {
  data?: { code?: string; httpStatus?: number } | null;
}

/** A tRPC UNAUTHORIZED / HTTP 401 answer from the server. */
export function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as ErrorWithTrpcData).data;
  return data?.code === "UNAUTHORIZED" || data?.httpStatus === 401;
}

/**
 * True only when the refresh endpoint said the session is over. Anything
 * without a server answer (fetch TypeError, AbortError, offline) or with a
 * non-401 status is transient.
 */
export function isDefinitiveAuthFailure(error: unknown): boolean {
  return error instanceof SessionEndedError || isUnauthorizedError(error);
}

export interface RefreshCoordinatorOptions {
  /** One refresh attempt; throws on failure. */
  refresh: () => Promise<void>;
  /** Called once when the refresh is definitively rejected. */
  onAuthFailure: (error: unknown) => void;
  /** Waits between failed attempts. Default 1s, 2s, 4s, 8s. */
  retryDelaysMs?: number[];
  /** How long one call waits for the network to come back before giving up. */
  offlineWaitMs?: number;
  isOnline?: () => boolean;
  /** Resolves when the browser goes back online, or after `timeoutMs`. */
  waitForOnline?: (timeoutMs: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultIsOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

function defaultWaitForOnline(timeoutMs: number): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener("online", done);
  });
}

/**
 * Single-flight refresh: concurrent callers share one in-flight attempt.
 * Resolves when the session has fresh tokens; rejects with the server's error
 * after calling `onAuthFailure` when the session is over, or with
 * SessionRefreshUnavailableError when no verdict could be reached.
 */
export function createRefreshCoordinator(options: RefreshCoordinatorOptions) {
  const delays = options.retryDelaysMs ?? [1000, 2000, 4000, 8000];
  const offlineWaitMs = options.offlineWaitMs ?? 15_000;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const waitForOnline = options.waitForOnline ?? defaultWaitForOnline;
  const sleep = options.sleep ?? defaultSleep;

  let inFlight: Promise<void> | null = null;

  async function run(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (!isOnline()) {
        await waitForOnline(offlineWaitMs);
        if (!isOnline()) throw new SessionRefreshUnavailableError(lastError);
      }
      try {
        await options.refresh();
        return;
      } catch (error) {
        if (isDefinitiveAuthFailure(error)) {
          options.onAuthFailure(error);
          throw error;
        }
        lastError = error;
        if (attempt < delays.length) await sleep(delays[attempt]);
      }
    }
    throw new SessionRefreshUnavailableError(lastError);
  }

  return {
    refresh(): Promise<void> {
      if (!inFlight) {
        inFlight = run().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    get isRefreshing(): boolean {
      return inFlight !== null;
    },
  };
}

/**
 * Run `fn` while holding a lock shared by every tab of this origin, so two
 * tabs never send the same refresh token. Falls back to no lock where the
 * Web Locks API is missing (it is a best effort; the server tolerates a
 * concurrent refresh within its grace window).
 */
export async function withCrossTabLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request(name, fn) as Promise<T>;
}

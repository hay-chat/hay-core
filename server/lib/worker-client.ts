/**
 * Core's HTTP client for plugin workers.
 *
 * Each worker listens on loopback and requires the random secret core minted
 * for it at spawn (HAY_WORKER_SECRET, sent back as `x-hay-worker-secret`).
 * Every core → worker call goes through {@link workerFetch} so the secret is
 * attached in one place and never leaves core except to that worker.
 */
import { randomBytes } from "crypto";

export const WORKER_SECRET_HEADER = "x-hay-worker-secret";
export const WORKER_HOST = "127.0.0.1";

const secretsByPort = new Map<number, string>();

/** Mint and remember the secret for a worker about to listen on `port`. */
export function issueWorkerSecret(port: number): string {
  const secret = randomBytes(32).toString("hex");
  secretsByPort.set(port, secret);
  return secret;
}

/**
 * Forget a worker's secret once its port is released. Only removes `secret`,
 * so a late exit of an old worker can't drop the secret of a newer one that
 * reused the port.
 */
export function revokeWorkerSecret(port: number, secret: string): void {
  if (secretsByPort.get(port) === secret) secretsByPort.delete(port);
}

/** Base URL of the worker on `port`. */
export function workerBaseUrl(port: number): string {
  return `http://${WORKER_HOST}:${port}`;
}

/** Headers authenticating core to the worker on `port` (empty if it has no secret). */
export function workerAuthHeaders(port: number): Record<string, string> {
  const secret = secretsByPort.get(port);
  return secret ? { [WORKER_SECRET_HEADER]: secret } : {};
}

/**
 * `fetch` a worker endpoint. `path` is the path (and query) on the worker,
 * starting with "/". Caller headers are kept; the worker secret is added last.
 */
export function workerFetch(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(workerAuthHeaders(port))) {
    headers.set(name, value);
  }
  return fetch(`${workerBaseUrl(port)}${path}`, { ...init, headers });
}

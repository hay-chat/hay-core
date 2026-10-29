/**
 * Tiny Shopify Admin GraphQL client for the seed script. Reads go out as-is; writes go through
 * `mutate`, which in dry-run prints the operation and its variables and returns a placeholder.
 * Dry-run never sends anything, so it needs no credentials (callers skip lookups themselves).
 */
import { http, log, type Flags } from "../lib/data";

/** Same version the Hay.chat Shopify plugin defaults to (plugins/core/shopify/src/index.ts). */
export const API_VERSION = "2026-04";

const MAX_ATTEMPTS = 4;

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export interface Shopify {
  dryRun: boolean;
  query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
  mutate<T>(document: string, variables: Record<string, unknown>, dryRunResult: T): Promise<T>;
}

/** "mutation ProductSet(...)" → "ProductSet"; used in dry-run output and errors. */
export function operationName(document: string): string {
  return /\b(?:query|mutation)\s+(\w+)/.exec(document)?.[1] ?? "anonymous";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createShopify(
  flags: Flags,
  domain: string,
  token: string,
  options: { retryDelayMs?: number } = {},
): Shopify {
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
  const retryDelayMs = options.retryDelayMs ?? 2000;

  async function send<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const response = await http<GqlResponse<T>>({ ...flags, dryRun: false }, "POST", url, {
        headers: { "X-Shopify-Access-Token": token },
        body: { query: document, variables },
      });
      const errors = response.errors ?? [];
      // Cost-based rate limit: wait for the bucket to refill and retry.
      if (errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
      if (errors.length > 0) {
        throw new Error(`${operationName(document)}: ${errors.map((e) => e.message).join("; ")}`);
      }
      return response.data as T;
    }
  }

  return {
    dryRun: flags.dryRun,
    query: send,
    async mutate<T>(
      document: string,
      variables: Record<string, unknown>,
      dryRunResult: T,
    ): Promise<T> {
      if (flags.dryRun) {
        log(`  [dry-run] ${operationName(document)} ${JSON.stringify(variables)}`);
        return dryRunResult;
      }
      return send<T>(document, variables);
    },
  };
}

/** Throws when a mutation payload carries userErrors (Shopify's per-field validation errors). */
export function assertNoUserErrors(
  operation: string,
  payload: { userErrors?: { field?: string[] | null; message: string }[] } | null | undefined,
): void {
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    const text = errors.map((e) =>
      e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message,
    );
    throw new Error(`${operation}: ${text.join("; ")}`);
  }
}

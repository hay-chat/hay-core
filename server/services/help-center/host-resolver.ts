import { config } from "@server/config/env";
import { AppDataSource } from "@server/database/data-source";
import { HelpCenter } from "@server/database/entities/help-center.entity";
import { createLogger } from "@server/lib/logger";
import { helpCenterBaseHostname, isHelpCenterEnabled } from "./urls";

const logger = createLogger("help-center-host");

/**
 * What a request's hostname means for help centers.
 * - `none`: not a help center host; the request belongs to the API.
 * - `unknown`: under the help center domain, but no site has that address.
 * - `site`: this help center (published or not; the caller decides what to show).
 */
export type HelpCenterHostMatch =
  { kind: "none" } | { kind: "unknown" } | { kind: "site"; helpCenter: HelpCenter };

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 5_000;
const cache = new Map<string, { match: HelpCenterHostMatch; expiresAt: number }>();

const FAILURE_TTL_MS = 5_000;
/** A hostname of sane length and characters; anything else is never looked up or cached. */
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function remember(hostname: string, match: HelpCenterHostMatch, ttlMs: number): void {
  // Oldest first out: a flood of made-up hostnames must not evict every real site at once.
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(hostname, { match, expiresAt: Date.now() + ttlMs });
}

/** Drop cached lookups after a help center changes, so this instance sees it at once. */
export function clearHelpCenterHostCache(): void {
  cache.clear();
}

function hostnameOf(domain: string): string {
  return domain.replace(/:\d+$/, "").toLowerCase();
}

/** Hosts that always belong to the dashboard and API, whatever anyone claims. */
export function isPlatformHostname(hostname: string): boolean {
  return [config.domain.api, config.domain.dashboard, config.domain.base]
    .filter(Boolean)
    .some((domain) => hostnameOf(domain) === hostname);
}

async function lookup(hostname: string): Promise<HelpCenterHostMatch> {
  const base = helpCenterBaseHostname();
  const repository = AppDataSource.getRepository(HelpCenter);

  // First, so no help center address can ever stand in for the dashboard or API, even
  // when those live under the help center domain.
  if (isPlatformHostname(hostname)) return { kind: "none" };
  if (hostname === base) return { kind: "unknown" };
  if (hostname.endsWith(`.${base}`)) {
    const label = hostname.slice(0, -(base.length + 1));
    if (label.includes(".")) return { kind: "unknown" };
    const helpCenter = await repository.findOne({ where: { subdomain: label } });
    return helpCenter ? { kind: "site", helpCenter } : { kind: "unknown" };
  }

  const helpCenter = await repository
    .createQueryBuilder("helpCenter")
    .where("helpCenter.customDomain = :hostname", { hostname })
    .andWhere("helpCenter.customDomainVerifiedAt IS NOT NULL")
    .getOne();
  return helpCenter ? { kind: "site", helpCenter } : { kind: "none" };
}

/**
 * Resolve a request hostname (no port) to a help center. Results are cached
 * briefly, misses included, so unknown hosts cannot be used to hammer the
 * database.
 */
export async function resolveHelpCenterHost(rawHostname: string): Promise<HelpCenterHostMatch> {
  if (!isHelpCenterEnabled()) return { kind: "none" };
  const hostname = rawHostname.toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_PATTERN.test(hostname)) return { kind: "none" };

  const cached = cache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.match;

  let match: HelpCenterHostMatch;
  try {
    match = await lookup(hostname);
  } catch (error) {
    // Also the path taken while the help center migration is still pending. Remembered
    // briefly, so a database problem is not retried and logged on every request.
    logger.warn({ err: error }, "Help center host lookup failed");
    remember(hostname, { kind: "none" }, FAILURE_TTL_MS);
    return { kind: "none" };
  }

  remember(hostname, match, CACHE_TTL_MS);
  return match;
}

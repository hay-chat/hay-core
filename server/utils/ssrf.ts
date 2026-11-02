import dns from "dns/promises";
import type { LookupAddress } from "dns";
import http from "http";
import https from "https";
import net, { type LookupFunction } from "net";
import { Agent } from "undici";

/**
 * Outbound requests to URLs supplied by tenants, plugins or remote servers
 * must only reach public internet addresses.
 *
 * - `validateUrlForSSRF` checks a URL up front (scheme + every resolved address).
 * - `ssrfSafeLookup` re-resolves and re-checks at connect time, so the socket is
 *   pinned to an address that passed the check (no DNS-rebinding window).
 * - `safeFetch` / `ssrfSafeHttpAgent` / `ssrfSafeHttpsAgent` wire both together
 *   for `fetch` and axios callers.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const BLOCKED_RANGES = new net.BlockList();

// IPv4 special-purpose ranges (RFC 6890 and successors) — none are publicly routable.
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  BLOCKED_RANGES.addSubnet(prefix, bits, "ipv4");
}

// IPv6: only global unicast (2000::/3) is reachable; within it, block the
// special-purpose blocks. Everything else (::, ::1, fc00::/7, fe80::/10,
// ff00::/8, IPv4-mapped ::ffff:0:0/96, NAT64 64:ff9b::/96, ...) is outside 2000::/3.
const IPV6_GLOBAL_UNICAST = new net.BlockList();
IPV6_GLOBAL_UNICAST.addSubnet("2000::", 3, "ipv6");
for (const [prefix, bits] of [
  ["2001::", 23], // IETF protocol assignments (incl. Teredo)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an arbitrary IPv4 address)
  ["3fff::", 20], // documentation
] as const) {
  BLOCKED_RANGES.addSubnet(prefix, bits, "ipv6");
}

/** Strip the brackets URL.hostname keeps around IPv6 literals. */
function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * True unless `ip` is a publicly routable unicast address. Anything that is not
 * a valid IP literal counts as blocked.
 */
export function isBlockedAddress(rawIp: string): boolean {
  const ip = bareHost(rawIp);
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED_RANGES.check(ip, "ipv4");
  if (family === 6) {
    return !IPV6_GLOBAL_UNICAST.check(ip, "ipv6") || BLOCKED_RANGES.check(ip, "ipv6");
  }
  return true;
}

/**
 * Resolve `hostname` and return its addresses, failing closed: resolution
 * errors, empty answers and any non-public address all throw.
 */
export async function resolvePublicAddresses(
  hostname: string,
  family?: number,
): Promise<LookupAddress[]> {
  const host = bareHost(hostname);
  let addresses: LookupAddress[];
  const literal = net.isIP(host);
  if (literal) {
    addresses = [{ address: host, family: literal }];
  } else {
    try {
      addresses = await dns.lookup(host, {
        all: true,
        family: family === 4 || family === 6 ? family : 0,
      });
    } catch {
      throw new SsrfBlockedError(`Blocked request: could not resolve host ${host}`);
    }
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`Blocked request: could not resolve host ${host}`);
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SsrfBlockedError(`Blocked request to private/internal IP: ${host} (${address})`);
    }
  }
  return addresses;
}

/**
 * Validate a URL is safe to fetch: http(s) only, and every address the host
 * resolves to is public. Pair with `safeFetch` / the safe agents so the
 * connection itself is pinned to a checked address.
 */
export async function validateUrlForSSRF(url: string | URL): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError("Blocked request: invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Blocked request to disallowed protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError("Blocked request: URLs with credentials are not allowed");
  }
  await resolvePublicAddresses(parsed.hostname);
}

/**
 * `lookup` for net/tls sockets that only ever hands back checked public
 * addresses. Node skips `lookup` for IP-literal hosts, which is why callers
 * still run `validateUrlForSSRF` first.
 */
export const ssrfSafeLookup: LookupFunction = (hostname, options, callback) => {
  resolvePublicAddresses(hostname, options.family as number | undefined).then(
    (addresses) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
    (error: NodeJS.ErrnoException) => callback(error, "", 0),
  );
};

/** For axios / node:http callers: `{ httpAgent: ssrfSafeHttpAgent, httpsAgent: ssrfSafeHttpsAgent, proxy: false }`. */
export const ssrfSafeHttpAgent = new http.Agent({ lookup: ssrfSafeLookup });
export const ssrfSafeHttpsAgent = new https.Agent({ lookup: ssrfSafeLookup });

const ssrfSafeDispatcher = new Agent({ connect: { lookup: ssrfSafeLookup } });

export type SafeFetchInit = RequestInit & { timeoutMs: number };

/**
 * `fetch` for untrusted URLs: validated up front, connection pinned to a
 * checked address, redirects never followed (a 3xx is returned as-is), and
 * always bounded by a timeout.
 */
export async function safeFetch(url: string | URL, init: SafeFetchInit): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init;
  await validateUrlForSSRF(url);
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...rest,
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    // Node's fetch accepts an undici dispatcher; the DOM RequestInit type does not declare it.
    ...({ dispatcher: ssrfSafeDispatcher } as RequestInit),
  });
}

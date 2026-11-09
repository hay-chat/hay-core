/**
 * Which destinations a plugin worker may reach through the egress proxy.
 *
 * A plugin declares them in package.json under `hay-plugin.network.egress`:
 * - "api.example.com"            host on port 443
 * - "api.example.com:8443"       host and port
 * - "*.example.com"              any subdomain of example.com
 * - { "fromConfig": "baseUrl" }  the host in the organization's config value
 *                                (bare host, host:port or a full URL)
 * - { "fromConfig": "subdomain", "suffix": ".zendesk.com" }
 *                                as above; a bare label gets the suffix, and a
 *                                dotted value must already end with it
 *
 * Core turns the declaration into concrete "host:port" rules when it starts a
 * worker; the proxy only ever sees rules. Pure functions: this file is used by
 * both core and the proxy.
 */
import { BlockList, isIP } from "net";

export type EgressEntry = string | { fromConfig: string; suffix?: string };

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface AllowRule {
  /** Exact host, or the parent domain when `wildcard` is set. */
  host: string;
  wildcard: boolean;
  port: number;
}

function validHost(host: string): boolean {
  return host.length <= 253 && HOST_PATTERN.test(host) && isIP(host) === 0;
}

/** Parse a "host", "host:port" or "*.parent[:port]" rule. Null when malformed. */
export function parseAllowRule(text: string): AllowRule | null {
  const match = /^(\*\.)?([^:]+)(?::(\d{1,5}))?$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  const port = match[3] ? Number(match[3]) : 443;
  if (port < 1 || port > 65535 || !validHost(match[2])) return null;
  return { host: match[2], wildcard: Boolean(match[1]), port };
}

function formatRule(rule: AllowRule): string {
  return `${rule.wildcard ? "*." : ""}${rule.host}:${rule.port}`;
}

/**
 * The host and port in a config value, or null if it isn't a usable public
 * host name. IP addresses are refused here and again by the proxy.
 */
export function hostFromConfigValue(
  value: unknown,
  suffix?: string,
): { host: string; port: number } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim().toLowerCase();
  let host: string;
  let port: number | null = null;
  let scheme = "https";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    scheme = url.protocol.slice(0, -1);
    host = url.hostname;
    port = url.port ? Number(url.port) : null;
  } catch {
    return null;
  }
  if (suffix) {
    if (LABEL_PATTERN.test(host)) host = `${host}${suffix}`;
    else if (!host.endsWith(suffix.toLowerCase())) return null;
  }
  if (!validHost(host)) return null;
  return { host, port: port ?? (scheme === "http" ? 80 : 443) };
}

/**
 * Concrete rules for one worker. `config` is the organization's resolved
 * config; an entry whose config value is missing or unusable adds nothing.
 */
export function resolveEgressAllow(
  entries: readonly EgressEntry[] | undefined,
  config: Record<string, unknown>,
): string[] {
  const rules: string[] = [];
  for (const entry of entries ?? []) {
    if (typeof entry === "string") {
      const rule = parseAllowRule(entry);
      if (rule) rules.push(formatRule(rule));
      continue;
    }
    const target = hostFromConfigValue(config[entry.fromConfig], entry.suffix);
    if (target) rules.push(`${target.host}:${target.port}`);
  }
  return [...new Set(rules)];
}

/** Whether `host:port` matches one of the rules. `host` is lower-cased by the caller. */
export function isAllowed(rules: readonly AllowRule[], host: string, port: number): boolean {
  return rules.some((rule) => {
    if (rule.port !== port) return false;
    if (!rule.wildcard) return host === rule.host;
    return host.endsWith(`.${rule.host}`);
  });
}

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** Loopback, private, link-local, CGNAT, unique-local, multicast, reserved and IPv4-mapped addresses. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  // Node's BlockList treats IPv4 addresses as members of ::ffff:0:0/96, so mapped
  // addresses are recognized by their normalized text instead.
  if (family === 6 && new URL(`http://[${address}]`).hostname.startsWith("[::ffff:")) return true;
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

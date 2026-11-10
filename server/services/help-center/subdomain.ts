/**
 * Rules for the label an organization picks under the help center domain
 * (`<label>.<HELP_CENTER_DOMAIN>`).
 */

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 63;

/** Prefix of the random CNAME targets (see HelpCenter.customDomainTarget). */
export const CUSTOM_DOMAIN_TARGET_PREFIX = "hc-";

/** Labels kept for the platform itself, so no organization can pose as it. */
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "dashboard",
  "mail",
  "email",
  "smtp",
  "status",
  "docs",
  "help",
  "support",
  "blog",
  "cdn",
  "assets",
  "static",
  "media",
  "files",
  "auth",
  "login",
  "account",
  "accounts",
  "billing",
  "security",
  "abuse",
  "postmaster",
  "hay",
  "haychat",
  "staging",
  "test",
  "demo",
  "cname",
  "custom",
  "ns1",
  "ns2",
]);

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SubdomainProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

export function normalizeSubdomain(input: string): string {
  return input.trim().toLowerCase();
}

/** Why a (normalized) label cannot be used, or null when it is fine. */
export function subdomainProblem(label: string): SubdomainProblem | null {
  if (label.length < SUBDOMAIN_MIN_LENGTH) return "too_short";
  if (label.length > SUBDOMAIN_MAX_LENGTH) return "too_long";
  if (!LABEL_PATTERN.test(label)) return "invalid_characters";
  // "xn--" labels are punycode: they can render as look-alikes of another name.
  if (label.startsWith("xn--")) return "invalid_characters";
  if (RESERVED_SUBDOMAINS.has(label) || label.startsWith(CUSTOM_DOMAIN_TARGET_PREFIX)) {
    return "reserved";
  }
  return null;
}

/** A starting suggestion from free text such as the organization's name. May still be taken. */
export function suggestSubdomain(text: string): string {
  const label = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SUBDOMAIN_MAX_LENGTH)
    .replace(/-+$/, "");
  return subdomainProblem(label) ? "" : label;
}

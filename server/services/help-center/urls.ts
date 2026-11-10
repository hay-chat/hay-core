import { config, getProtocol } from "@server/config/env";
import type { HelpCenter } from "@server/database/entities/help-center.entity";

/** Whether this server is set up to serve help centers at all. */
export function isHelpCenterEnabled(): boolean {
  return config.helpCenter.domain !== "";
}

/** The help center domain without a port, for comparing with a request's hostname. */
export function helpCenterBaseHostname(): string {
  return config.helpCenter.domain.replace(/:\d+$/, "");
}

/** The port part (":3001") of HELP_CENTER_DOMAIN, set only in local development. */
function helpCenterPort(): string {
  return config.helpCenter.domain.match(/:\d+$/)?.[0] ?? "";
}

/** Hostname of a help center's built-in address. */
export function defaultHostname(helpCenter: Pick<HelpCenter, "subdomain">): string {
  return `${helpCenter.subdomain}.${helpCenterBaseHostname()}`;
}

/** The built-in address, which keeps working after a custom domain is added. */
export function defaultUrl(helpCenter: Pick<HelpCenter, "subdomain">): string {
  return `${getProtocol()}://${defaultHostname(helpCenter)}${helpCenterPort()}`;
}

/** Hostname a custom domain's CNAME record must point at. */
export function customDomainTargetHostname(
  helpCenter: Pick<HelpCenter, "customDomainTarget">,
): string {
  return `${helpCenter.customDomainTarget}.${helpCenterBaseHostname()}`;
}

type DomainFields = Pick<HelpCenter, "subdomain" | "customDomain" | "customDomainVerifiedAt">;

/** The address to show people and search engines: the verified custom domain, else the built-in one. */
export function canonicalUrl(helpCenter: DomainFields): string {
  if (helpCenter.customDomain && helpCenter.customDomainVerifiedAt) {
    return `${getProtocol()}://${helpCenter.customDomain}`;
  }
  return defaultUrl(helpCenter);
}

/** Every hostname that serves this help center right now. */
export function servedHostnames(helpCenter: DomainFields): string[] {
  const hosts = [defaultHostname(helpCenter)];
  if (helpCenter.customDomain && helpCenter.customDomainVerifiedAt) {
    hosts.push(helpCenter.customDomain);
  }
  return hosts;
}

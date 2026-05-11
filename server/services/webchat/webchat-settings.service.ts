import { webchatSettingsRepository } from "@server/repositories/webchat-settings.repository";
import {
  WebchatSettings,
  WebchatPosition,
  WebchatTheme,
} from "@server/database/entities/webchat-settings.entity";
import { organizationRepository } from "@server/repositories/organization.repository";
import { agentRepository } from "@server/repositories/agent.repository";
import { storageService } from "@server/services/storage.service";
import type { FormSchema } from "@hay/form-schema";
import { formSchemaSchema } from "@hay/form-schema";

export interface WebchatSettingsUpdateDTO {
  widgetTitle?: string;
  widgetSubtitle?: string | null;
  position?: WebchatPosition;
  theme?: WebchatTheme;
  showGreeting?: boolean;
  greetingMessage?: string | null;
  allowedDomains?: string[];
  isEnabled?: boolean;
  customCss?: string | null;
  spamClassifierEnabled?: boolean;
  spamGuidance?: string | null;
  preChatForm?: FormSchema | null;
}

export class WebchatSettingsService {
  /**
   * Get webchat settings for an organization
   */
  async getSettings(organizationId: string): Promise<WebchatSettings> {
    return await webchatSettingsRepository.getOrCreate(organizationId);
  }

  /**
   * Update webchat settings
   */
  async updateSettings(
    organizationId: string,
    data: WebchatSettingsUpdateDTO,
  ): Promise<WebchatSettings> {
    if (data.preChatForm) {
      formSchemaSchema.parse(data.preChatForm);
    }
    return await webchatSettingsRepository.update(organizationId, data);
  }

  /**
   * Check if webchat is enabled for an organization
   */
  async isEnabled(organizationId: string): Promise<boolean> {
    return await webchatSettingsRepository.isEnabled(organizationId);
  }

  /**
   * Get public configuration for the widget (no sensitive data)
   */
  async getPublicConfig(organizationId: string): Promise<{
    widgetTitle: string;
    widgetSubtitle: string | null;
    position: WebchatPosition;
    theme: WebchatTheme;
    showGreeting: boolean;
    greetingMessage: string | null;
    agentName: string | null;
    agentAvatarUrl: string | null;
    organizationLogoUrl: string | null;
    preChatForm: FormSchema | null;
  }> {
    const settings = await this.getSettings(organizationId);

    // Load organization with logo
    const organization = await organizationRepository.findById(organizationId);

    // Load default agent with avatar
    let agentName: string | null = null;
    let agentAvatarUrl: string | null = null;

    if (organization?.defaultAgentId) {
      const agent = await agentRepository.findByIdAndOrganization(
        organization.defaultAgentId,
        organizationId,
      );
      if (agent) {
        agentName = agent.name;
        if (agent.avatarUpload) {
          agentAvatarUrl = storageService.getUrl(agent.avatarUpload);
        }
      }
    }

    // Get organization logo URL
    const organizationLogoUrl = organization?.logoUpload
      ? storageService.getUrl(organization.logoUpload)
      : null;

    return {
      widgetTitle: settings.widgetTitle,
      widgetSubtitle: settings.widgetSubtitle,
      position: settings.position,
      theme: settings.theme,
      showGreeting: settings.showGreeting,
      greetingMessage: settings.greetingMessage,
      agentName,
      agentAvatarUrl,
      organizationLogoUrl,
      preChatForm: settings.preChatForm ?? null,
    };
  }

  /**
   * Whether a page on `hostname` may start widget conversations for this org.
   */
  async isDomainAllowed(organizationId: string, hostname: string | null): Promise<boolean> {
    const settings = await this.getSettings(organizationId);
    return matchesAllowedDomains(settings.allowedDomains, hostname);
  }
}

/**
 * Reduce an allowed-domain entry to a bare lowercase hostname, so entries typed
 * as "https://Shop.com/", "shop.com:443" or "shop.com." all mean "shop.com".
 */
function normalizeDomainEntry(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

/**
 * Match a request hostname against an org's allowed domains.
 *
 * - `*` allows every site.
 * - `example.com` allows exactly that host.
 * - `*.example.com` allows any subdomain of example.com (not the bare domain,
 *   and not look-alikes such as `evilexample.com`).
 *
 * A missing hostname only passes the `*` rule.
 */
export function matchesAllowedDomains(allowedDomains: string[], hostname: string | null): boolean {
  const entries = allowedDomains.map(normalizeDomainEntry).filter(Boolean);
  if (entries.includes("*")) return true;
  if (!hostname) return false;

  const host = hostname.toLowerCase().replace(/\.$/, "");
  return entries.some((entry) => {
    if (entry.startsWith("*.")) {
      return host.endsWith(entry.substring(1));
    }
    return entry === host;
  });
}

export const webchatSettingsService = new WebchatSettingsService();

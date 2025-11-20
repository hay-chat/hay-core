import { webchatSettingsRepository } from "@server/repositories/webchat-settings.repository";
import { WebchatSettings, WebchatPosition, WebchatTheme } from "@server/database/entities/webchat-settings.entity";

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
    data: WebchatSettingsUpdateDTO
  ): Promise<WebchatSettings> {
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
  }> {
    const settings = await this.getSettings(organizationId);

    return {
      widgetTitle: settings.widgetTitle,
      widgetSubtitle: settings.widgetSubtitle,
      position: settings.position,
      theme: settings.theme,
      showGreeting: settings.showGreeting,
      greetingMessage: settings.greetingMessage,
    };
  }

  /**
   * Validate if a domain is allowed to embed the widget
   */
  async isDomainAllowed(organizationId: string, domain: string): Promise<boolean> {
    const settings = await this.getSettings(organizationId);

    // If allowedDomains contains '*', allow all domains
    if (settings.allowedDomains.includes("*")) {
      return true;
    }

    // Check if the domain matches any allowed domain
    return settings.allowedDomains.some((allowed) => {
      // Exact match
      if (allowed === domain) {
        return true;
      }

      // Wildcard subdomain match (e.g., *.example.com matches app.example.com)
      if (allowed.startsWith("*.")) {
        const baseDomain = allowed.substring(2);
        return domain.endsWith(baseDomain);
      }

      return false;
    });
  }
}

export const webchatSettingsService = new WebchatSettingsService();

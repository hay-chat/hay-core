import { webchatSettingsRepository } from "@server/repositories/webchat-settings.repository";
import {
  WebchatSettings,
  WebchatPosition,
  type WebchatBrandingSource,
  type WebchatLauncherIcon,
  type WebchatLauncherIconStyle,
  type WebchatPageToolsSettings,
  type WebchatThemeMode,
} from "@server/database/entities/webchat-settings.entity";
import { AppDataSource } from "@server/database/data-source";
import { HelpCenter } from "@server/database/entities/help-center.entity";
import { organizationRepository } from "@server/repositories/organization.repository";
import { isHelpCenterEnabled, servedHostnames } from "@server/services/help-center/urls";
import { storageService } from "@server/services/storage.service";
import { Upload } from "@server/entities/upload.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import type { Organization } from "@server/entities/organization.entity";
import type { AssistantAvatarPreset } from "@server/types/organization-settings.types";
import { ACTIONS, RESOURCES } from "@server/types/scopes";
import { createLogger } from "@server/lib/logger";
import type { FormSchema } from "@hay/form-schema";
import { formSchemaSchema } from "@hay/form-schema";

const logger = createLogger("webchat-settings");

export interface WebchatSettingsUpdateDTO {
  widgetTitle?: string;
  position?: WebchatPosition;
  themeMode?: WebchatThemeMode;
  brandColor?: string;
  launcherIcon?: WebchatLauncherIcon;
  launcherIconStyle?: WebchatLauncherIconStyle;
  homeHeading?: string | null;
  showGreeting?: boolean;
  greetingMessage?: string | null;
  teaserMessage?: string | null;
  csatEnabled?: boolean;
  csatQuestion?: string | null;
  allowedDomains?: string[];
  isEnabled?: boolean;
  customCss?: string | null;
  spamClassifierEnabled?: boolean;
  spamGuidance?: string | null;
  preChatForm?: FormSchema | null;
  pageTools?: WebchatPageToolsSettings;
}

/** A team member shown in the widget header (C1). */
export interface WebchatTeamMember {
  firstName: string;
  avatarUrl: string | null;
}

/** What the widget loads (C1); the route adds `enabled`, contributions and the AI label. */
export interface WebchatPublicConfig {
  widgetTitle: string;
  /** The organization's display name ("Support team · {name}" when a person has taken over). */
  organizationName: string | null;
  position: WebchatPosition;
  brandColor: string;
  themeMode: WebchatThemeMode;
  logoUrl: string | null;
  homeHeading: string | null;
  team: WebchatTeamMember[];
  showGreeting: boolean;
  greetingMessage: string | null;
  teaserMessage: string | null;
  csatEnabled: boolean;
  csatQuestion: string | null;
  agentName: string | null;
  agentAvatarUrl: string | null;
  /** The assistant's icon when it has no uploaded avatar. */
  agentAvatarPreset: AssistantAvatarPreset;
  /** The chat button's icon; "custom" comes with launcherIconUrl. */
  launcherIcon: WebchatLauncherIcon;
  launcherIconStyle: WebchatLauncherIconStyle;
  launcherIconUrl: string | null;
  preChatForm: FormSchema | null;
}

/** Webchat settings as the dashboard sees them (C2). */
export type WebchatSettingsView = Omit<
  WebchatSettings,
  | "organization"
  | "identitySecret"
  | "logoUpload"
  | "logoUploadId"
  | "launcherIconUpload"
  | "launcherIconUploadId"
  | "brandingImportedAt"
  | "lastSeenAt"
  | "underAttackUntil"
  | "createdAt"
  | "updatedAt"
> & {
  logoUrl: string | null;
  logoSource: WebchatBrandingSource | null;
  launcherIconUrl: string | null;
  lastSeenAt: string | null;
  lastSeenOrigin: string | null;
  underAttackUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_TEAM_MEMBERS = 2;
/** Install detection writes at most once per minute per organization. */
const LAST_SEEN_THROTTLE_MS = 60_000;
const MAX_TRACKED_ORGANIZATIONS = 10_000;

async function uploadUrl(uploadId: string | null): Promise<string | null> {
  if (!uploadId) return null;
  const upload = await Upload.findOne({ where: { id: uploadId } });
  return upload ? storageService.getUrl(upload) : null;
}

export class WebchatSettingsService {
  private readonly lastSeenWrites = new Map<string, number>();

  /**
   * Get webchat settings for an organization
   */
  async getSettings(organizationId: string): Promise<WebchatSettings> {
    return await webchatSettingsRepository.getOrCreate(organizationId);
  }

  /**
   * Called on the dashboard's settings read: with no logo and no colour yet,
   * and no import tried before, start the website branding import in the
   * background (once).
   */
  importBrandingIfNeverDone(settings: WebchatSettings): void {
    if (!settings.logoSource && !settings.brandColorSource && !settings.brandingImportedAt) {
      void this.startBrandingImport(settings.organizationId);
    }
  }

  async toView(settings: WebchatSettings): Promise<WebchatSettingsView> {
    const {
      organization: _organization,
      identitySecret: _identitySecret,
      logoUpload: _logoUpload,
      logoUploadId,
      launcherIconUpload: _launcherIconUpload,
      launcherIconUploadId,
      brandingImportedAt: _brandingImportedAt,
      lastSeenAt,
      underAttackUntil,
      createdAt,
      updatedAt,
      ...rest
    } = settings;
    return {
      ...rest,
      logoUrl: await uploadUrl(logoUploadId),
      launcherIconUrl: await uploadUrl(launcherIconUploadId),
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
      underAttackUntil: underAttackUntil ? new Date(underAttackUntil).toISOString() : null,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
    };
  }

  /**
   * Update webchat settings. A brand colour set here is the merchant's choice:
   * the website import no longer touches it.
   */
  async updateSettings(
    organizationId: string,
    data: WebchatSettingsUpdateDTO,
  ): Promise<WebchatSettingsView> {
    if (data.preChatForm) {
      formSchemaSchema.parse(data.preChatForm);
    }
    const update: Partial<WebchatSettings> = { ...data };
    if (data.brandColor !== undefined) {
      update.brandColor = data.brandColor.toLowerCase();
      update.brandColorSource = "custom";
    }
    return this.toView(await webchatSettingsRepository.update(organizationId, update));
  }

  /** Replace the widget logo with the merchant's own upload. */
  async setCustomLogo(organizationId: string, uploadId: string): Promise<WebchatSettingsView> {
    const settings = await this.getSettings(organizationId);
    const previous = settings.logoUploadId;
    const updated = await webchatSettingsRepository.update(organizationId, {
      logoUploadId: uploadId,
      logoSource: "custom",
    });
    if (previous && previous !== uploadId) await this.deleteUpload(previous);
    return this.toView(updated);
  }

  /**
   * Remove the widget logo (the widget falls back to the organization logo).
   * Counts as the merchant's choice, so the website import does not bring it back.
   */
  async removeLogo(organizationId: string): Promise<WebchatSettingsView> {
    const settings = await this.getSettings(organizationId);
    const previous = settings.logoUploadId;
    const updated = await webchatSettingsRepository.update(organizationId, {
      logoUploadId: null,
      logoSource: "custom",
    });
    if (previous) await this.deleteUpload(previous);
    return this.toView(updated);
  }

  /** Show the merchant's own icon on the chat button. */
  async setCustomLauncherIcon(
    organizationId: string,
    uploadId: string,
  ): Promise<WebchatSettingsView> {
    const settings = await this.getSettings(organizationId);
    const previous = settings.launcherIconUploadId;
    const updated = await webchatSettingsRepository.update(organizationId, {
      launcherIconUploadId: uploadId,
      launcherIcon: "custom",
    });
    if (previous && previous !== uploadId) await this.deleteUpload(previous);
    return this.toView(updated);
  }

  /** Remove the uploaded button icon; the button goes back to the chat bubble. */
  async removeLauncherIcon(organizationId: string): Promise<WebchatSettingsView> {
    const settings = await this.getSettings(organizationId);
    const previous = settings.launcherIconUploadId;
    const updated = await webchatSettingsRepository.update(organizationId, {
      launcherIconUploadId: null,
      ...(settings.launcherIcon === "custom" ? { launcherIcon: "chat" as const } : {}),
    });
    if (previous) await this.deleteUpload(previous);
    return this.toView(updated);
  }

  private async deleteUpload(uploadId: string): Promise<void> {
    await storageService
      .delete(uploadId)
      .catch((error) => logger.warn({ err: error, uploadId }, "Could not delete a webchat image"));
  }

  /** Website branding import for this organization's website, in the background. */
  async startBrandingImport(organizationId: string): Promise<void> {
    try {
      const { siteIndexService } = await import("@server/services/site-index.service");
      const website = await siteIndexService.resolveWebsite(organizationId);
      if (!website) return;
      const { brandingImportService } =
        await import("@server/services/branding-import/branding-import.service");
      brandingImportService.startImport(organizationId, website);
    } catch (error) {
      logger.warn({ err: error, organizationId }, "Could not start the website branding import");
    }
  }

  /**
   * Install detection (C2): remember the page origin that loaded the widget.
   * At most one check and write per organization per minute (per server
   * process). Pages outside the allowed domains do not count as an install.
   */
  async recordWidgetLoad(organizationId: string, origin: string, now = new Date()): Promise<void> {
    const last = this.lastSeenWrites.get(organizationId);
    if (last !== undefined && now.getTime() - last < LAST_SEEN_THROTTLE_MS) return;
    if (this.lastSeenWrites.size >= MAX_TRACKED_ORGANIZATIONS) this.lastSeenWrites.clear();
    this.lastSeenWrites.set(organizationId, now.getTime());
    if (!(await this.isDomainAllowed(organizationId, new URL(origin).hostname))) return;
    await webchatSettingsRepository.patch(organizationId, {
      lastSeenAt: now,
      lastSeenOrigin: origin.slice(0, 255),
    });
  }

  /**
   * Check if webchat is enabled for an organization
   */
  async isEnabled(organizationId: string): Promise<boolean> {
    return await webchatSettingsRepository.isEnabled(organizationId);
  }

  /**
   * Up to two people who can take over webchat conversations, for the widget
   * header (C1). Empty when hand-off to the team is off (the confidence
   * guardrail's escalation switch). Members who are available and seen most
   * recently come first; only first names and avatars leave the server.
   */
  async publicTeam(organization: Organization): Promise<WebchatTeamMember[]> {
    if (organization.settings?.confidenceGuardrail?.enableEscalation === false) return [];

    const memberships = await AppDataSource.getRepository(UserOrganization).find({
      where: { organizationId: organization.id, isActive: true },
      relations: { user: true },
    });
    return memberships
      .filter(
        (membership) =>
          membership.user?.isActive &&
          !membership.user.deletedAt &&
          membership.user.firstName?.trim() &&
          membership.hasScope(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE),
      )
      .map((membership) => membership.user)
      .sort((a, b) => {
        const available = Number(b.status === "available") - Number(a.status === "available");
        if (available !== 0) return available;
        return (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0);
      })
      .slice(0, MAX_TEAM_MEMBERS)
      .map((user) => ({ firstName: user.firstName!.trim(), avatarUrl: user.avatarUrl || null }));
  }

  /**
   * Get public configuration for the widget (no sensitive data)
   */
  async getPublicConfig(organizationId: string): Promise<WebchatPublicConfig> {
    const settings = await this.getSettings(organizationId);
    const organization = await organizationRepository.findById(organizationId);

    // The assistant's name and avatar (the widget falls back to its title)
    const agentName = organization?.assistantName?.trim() || null;
    const agentAvatarUrl = organization?.assistantAvatarUpload
      ? storageService.getUrl(organization.assistantAvatarUpload)
      : null;

    const launcherIconUrl =
      settings.launcherIcon === "custom" ? await uploadUrl(settings.launcherIconUploadId) : null;

    // Widget logo, else the organization logo.
    const logoUrl =
      (await uploadUrl(settings.logoUploadId)) ??
      (organization?.logoUpload ? storageService.getUrl(organization.logoUpload) : null);

    return {
      widgetTitle: settings.widgetTitle,
      organizationName: organization?.name?.trim() || null,
      position: settings.position,
      brandColor: settings.brandColor,
      themeMode: settings.themeMode,
      logoUrl,
      homeHeading: settings.homeHeading,
      team: organization ? await this.publicTeam(organization) : [],
      showGreeting: settings.showGreeting,
      greetingMessage: settings.greetingMessage,
      teaserMessage: settings.teaserMessage,
      csatEnabled: settings.csatEnabled,
      csatQuestion: settings.csatQuestion,
      agentName,
      agentAvatarUrl,
      agentAvatarPreset: organization?.settings?.assistantAvatarPreset ?? "sparkle",
      // "custom" with its upload gone (deleted elsewhere) falls back to the chat bubble.
      launcherIcon:
        settings.launcherIcon === "custom" && !launcherIconUrl ? "chat" : settings.launcherIcon,
      launcherIconStyle: settings.launcherIconStyle,
      launcherIconUrl,
      preChatForm: settings.preChatForm ?? null,
    };
  }

  /**
   * Whether a page on `hostname` may start widget conversations for this org.
   */
  async isDomainAllowed(organizationId: string, hostname: string | null): Promise<boolean> {
    const settings = await this.getSettings(organizationId);
    let allowed = settings.allowedDomains.filter((entry) => entry.trim());
    if (allowed.length === 0) {
      const { siteIndexService } = await import("@server/services/site-index.service");
      allowed = domainsForWebsite(await siteIndexService.resolveWebsite(organizationId));
    }
    return (
      matchesAllowedDomains(allowed, hostname) || isOwnHelpCenterHost(organizationId, hostname)
    );
  }
}

/**
 * The organization's help center always carries its own chat widget, without
 * anyone having to list the help center's address as an allowed domain.
 */
async function isOwnHelpCenterHost(
  organizationId: string,
  hostname: string | null,
): Promise<boolean> {
  if (!hostname || !isHelpCenterEnabled()) return false;
  try {
    const helpCenter = await AppDataSource.getRepository(HelpCenter).findOne({
      where: { organizationId },
    });
    const host = hostname.toLowerCase().replace(/\.$/, "");
    return helpCenter !== null && servedHostnames(helpCenter).includes(host);
  } catch {
    // The help center tables may not exist yet: code deploys before its migration runs.
    return false;
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

/** Allowed-domain entries for an organization's own website and its subdomains. */
export function domainsForWebsite(website: string | null | undefined): string[] {
  if (!website) return [];
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host ? [host, `*.${host}`] : [];
  } catch {
    return [];
  }
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

/**
 * AI disclosure (D14-6 / D14-7, EU AI Act art. 50(1)).
 *
 * Shoppers are told when a reply comes from AI: a badge on AI replies in the
 * widget ("web") and a line on the first AI reply on every other channel. The
 * label is on by default. An organization may rename it; only non-EU
 * organizations may hide it, per channel.
 *
 * Channels are keyed by their channel id (conversation.channel / a channel
 * plugin's manifest `channel`), never by plugin id.
 *
 * @module services/ai-disclosure
 */

import type { Organization } from "@server/entities/organization.entity";
import type { OrganizationSettings } from "@server/types/organization-settings.types";
import { regionFromSettings } from "./llm/ai-region";

export const AI_LABEL_MAX_LENGTH = 40;

type OrgLike = Pick<Organization, "timezone"> & { settings?: OrganizationSettings | null };

/**
 * EU signal for the label rule: the org opted in to EU-only AI processing, or
 * runs on a European time zone (the closest signal of serving EU shoppers until
 * organizations record a country). Errs on the side of disclosure.
 */
export function isEuOrganization(org: Partial<OrgLike> | null | undefined): boolean {
  if (!org) return false;
  return regionFromSettings(org.settings) === "eu" || !!org.timezone?.startsWith("Europe/");
}

/** The org's custom label, or null when the localized default applies. */
export function customAiLabel(settings: OrganizationSettings | null | undefined): string | null {
  const label = settings?.aiDisclosure?.label?.trim();
  return label ? label.slice(0, AI_LABEL_MAX_LENGTH) : null;
}

/** Whether AI replies on this channel carry the label. Always true for EU orgs. */
export function isAiLabelShown(org: Partial<OrgLike> | null | undefined, channel: string): boolean {
  if (isEuOrganization(org)) return true;
  return !(org?.settings?.aiDisclosure?.hiddenChannels ?? []).includes(channel);
}

/**
 * Organization access state.
 *
 * Hay core is billing-agnostic: an external operator (e.g. a hosted-plan
 * backoffice) decides when an organization loses access and tells core through
 * the `internal.organizations.setAccessState` procedure. Core only knows three
 * generic things — whether the org is suspended (and why), whether its AI agent
 * is paused (and why) and an optional notice to show in the dashboard.
 */

import { z } from "zod";

export const SUSPENSION_REASONS = [
  "trial_expired",
  "payment_failed",
  "cancelled",
  "manual",
] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

/**
 * Softer than a suspension: the AI stops replying (conversations go to Needs
 * Attention) while the dashboard keeps working. `usage_limit` = the plan's
 * included resolutions are used up and the operator refuses overage.
 */
export const AGENT_PAUSE_REASONS = ["usage_limit"] as const;
export type AgentPauseReason = (typeof AGENT_PAUSE_REASONS)[number];

export const ACCESS_NOTICE_LEVELS = ["info", "warning", "critical"] as const;
export type AccessNoticeLevel = (typeof ACCESS_NOTICE_LEVELS)[number];

export interface AccessNotice {
  /** Dashboard i18n key suffix (`accessNotice.<key>`); `text` is the fallback when unknown. */
  key: string;
  level: AccessNoticeLevel;
  /** Interpolation params for the i18n message (e.g. `{ date: "31 Oct 2026" }`). */
  params?: Record<string, string | number>;
  /** Free-text fallback shown when the dashboard has no translation for `key`. */
  text?: string;
  /** External link opened through the auth-code flow (same as external menu items). */
  ctaUrl?: string;
  ctaLabel?: string;
  /** ISO date; the dashboard hides the notice once it has passed. */
  expiresAt?: string;
}

/** Zod shape of {@link AccessNotice}, shared by the internal input and the auth.me output. */
export const accessNoticeSchema = z.object({
  key: z.string().min(1).max(64),
  level: z.enum(ACCESS_NOTICE_LEVELS).default("info"),
  params: z.record(z.union([z.string(), z.number()])).optional(),
  text: z.string().max(500).optional(),
  ctaUrl: z.string().url().max(2048).optional(),
  ctaLabel: z.string().max(80).optional(),
  expiresAt: z.string().datetime().optional(),
});

export interface OrganizationAccessState {
  suspendedAt: Date | null;
  suspensionReason: SuspensionReason | null;
  suspensionRedirectUrl: string | null;
  agentPausedAt: Date | null;
  agentPauseReason: AgentPauseReason | null;
  accessNotice: AccessNotice | null;
  /** The owner's "Pause AI everywhere" (D11-9); independent of the operator's pause. */
  aiPausedAt: Date | null;
  aiPausedByUserId: string | null;
}

/**
 * Whether the AI may not reply anywhere in the organization: the operator
 * paused it (agentPausedAt) or the team paused it (aiPausedAt).
 */
export function isOrganizationAiPaused(
  organization: { agentPausedAt?: Date | null; aiPausedAt?: Date | null } | null | undefined,
): boolean {
  return !!(organization?.agentPausedAt || organization?.aiPausedAt);
}

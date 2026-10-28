/**
 * Insights engine thresholds (D3-12, tuning hooks D3-18). Defaults come from
 * the research starting values and may be overridden by env (all orgs) and
 * then per organization in `organizations.settings.insights` (the Insights
 * page settings dialog). Tune them on real data.
 */
import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";

export interface InsightThresholds {
  /** Members within the window before a cluster is shown (Roger: 5, configurable). */
  minClusterSize: number;
  /** Cosine similarity for an issue to join a cluster (τ). */
  joinThreshold: number;
  /** Cosine similarity for two clusters with the same signature to merge (τ₂). */
  mergeThreshold: number;
  /** Clustering window in days. */
  windowDays: number;
  /** Weekly digest email to owners and admins (Roger: weekly digest only). */
  digestEnabled: boolean;
}

/** Owner-editable subset, stored in organizations.settings.insights. */
export type InsightSettingsOverride = Partial<
  Pick<InsightThresholds, "minClusterSize" | "joinThreshold" | "mergeThreshold" | "digestEnabled">
>;

export const THRESHOLD_LIMITS = {
  minClusterSize: { min: 2, max: 50 },
  joinThreshold: { min: 0.7, max: 0.98 },
  mergeThreshold: { min: 0.75, max: 0.99 },
} as const;

/** A cluster with no new member for this long is suggested for archiving (D3-16). */
export const ARCHIVE_SUGGESTION_DAYS = 45;
/** After `addressed`, wait this long before calling a cluster fixed or not (D3-16). */
export const FIXED_OBSERVATION_DAYS = 14;
/** Docs audit findings in dimensions scoring below this become issues (D3-15). */
export const DOCS_AUDIT_SCORE_THRESHOLD = 70;

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" && process.env[name] !== undefined
    ? value
    : fallback;
}

function clamp(value: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, value));
}

export function defaultThresholds(): InsightThresholds {
  return {
    minClusterSize: Math.round(envNumber("INSIGHTS_MIN_CLUSTER_SIZE", 5)),
    joinThreshold: envNumber("INSIGHTS_JOIN_THRESHOLD", 0.86),
    mergeThreshold: envNumber("INSIGHTS_MERGE_THRESHOLD", 0.91),
    windowDays: Math.round(envNumber("INSIGHTS_WINDOW_DAYS", 30)),
    digestEnabled: true,
  };
}

/** Defaults with an organization's override applied, clamped to sane limits. */
export function resolveThresholds(override: unknown): InsightThresholds {
  const base = defaultThresholds();
  const o = (override && typeof override === "object" ? override : {}) as InsightSettingsOverride;
  const minClusterSize = clamp(
    Math.round(typeof o.minClusterSize === "number" ? o.minClusterSize : base.minClusterSize),
    THRESHOLD_LIMITS.minClusterSize,
  );
  const joinThreshold = clamp(
    typeof o.joinThreshold === "number" ? o.joinThreshold : base.joinThreshold,
    THRESHOLD_LIMITS.joinThreshold,
  );
  const mergeThreshold = Math.max(
    joinThreshold,
    clamp(
      typeof o.mergeThreshold === "number" ? o.mergeThreshold : base.mergeThreshold,
      THRESHOLD_LIMITS.mergeThreshold,
    ),
  );
  return {
    minClusterSize,
    joinThreshold,
    mergeThreshold,
    windowDays: base.windowDays,
    digestEnabled: typeof o.digestEnabled === "boolean" ? o.digestEnabled : base.digestEnabled,
  };
}

export async function getOrganizationThresholds(
  organizationId: string,
): Promise<InsightThresholds> {
  const org = await AppDataSource.getRepository(Organization).findOne({
    where: { id: organizationId },
    select: ["id", "settings"],
  });
  return resolveThresholds(org?.settings?.insights);
}

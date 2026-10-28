import type { OrgLlmConfig } from "@server/services/llm/provider.types";
import type { AiRegion } from "@server/services/llm/ai-region";
import type { WriteCategory } from "@server/services/core/tool-risk";

export type { OrgLlmConfig };

export enum DateFormat {
  US = "MM/DD/YYYY",
  EU = "DD/MM/YYYY",
  ISO = "YYYY-MM-DD",
  READABLE = "DD MMM YYYY",
}

export enum TimeFormat {
  TWELVE_HOUR = "12h",
  TWENTY_FOUR_HOUR = "24h",
}

// IANA time zones — curated, not exhaustive
export enum Timezone {
  // Universal
  UTC = "UTC",

  // Europe (incl. UK & PT)
  Europe_Lisbon = "Europe/Lisbon",
  Europe_London = "Europe/London",
  Europe_Madrid = "Europe/Madrid",
  Europe_Paris = "Europe/Paris",
  Europe_Berlin = "Europe/Berlin",
  Europe_Amsterdam = "Europe/Amsterdam",
  Europe_Rome = "Europe/Rome",
  Europe_Zurich = "Europe/Zurich",
  Europe_Stockholm = "Europe/Stockholm",
  Europe_Athens = "Europe/Athens",
  Europe_Dublin = "Europe/Dublin",
  Europe_Prague = "Europe/Prague",
  Europe_Warsaw = "Europe/Warsaw",
  Europe_Bucharest = "Europe/Bucharest",
  Europe_Helsinki = "Europe/Helsinki",
  Europe_Moscow = "Europe/Moscow",

  // Atlantic islands (useful for PT, ES, CV)
  Atlantic_Azores = "Atlantic/Azores",
  Atlantic_Madeira = "Atlantic/Madeira",
  Atlantic_Canary = "Atlantic/Canary",
  Atlantic_Cape_Verde = "Atlantic/Cape_Verde",

  // Africa
  Africa_Casablanca = "Africa/Casablanca",
  Africa_Algiers = "Africa/Algiers",
  Africa_Lagos = "Africa/Lagos",
  Africa_Abidjan = "Africa/Abidjan",
  Africa_Accra = "Africa/Accra",
  Africa_Cairo = "Africa/Cairo",
  Africa_Johannesburg = "Africa/Johannesburg",
  Africa_Nairobi = "Africa/Nairobi",

  // Middle East
  Asia_Jerusalem = "Asia/Jerusalem",
  Asia_Beirut = "Asia/Beirut",
  Asia_Riyadh = "Asia/Riyadh",
  Asia_Dubai = "Asia/Dubai",
  Asia_Tehran = "Asia/Tehran",
  Asia_Baghdad = "Asia/Baghdad",
  Asia_Qatar = "Asia/Qatar",

  // South & Southeast Asia
  Asia_Kolkata = "Asia/Kolkata", // UTC+5:30
  Asia_Kathmandu = "Asia/Kathmandu", // UTC+5:45
  Asia_Dhaka = "Asia/Dhaka",
  Asia_Yangon = "Asia/Yangon", // UTC+6:30
  Asia_Bangkok = "Asia/Bangkok",
  Asia_Jakarta = "Asia/Jakarta",
  Asia_Singapore = "Asia/Singapore",
  Asia_Kuala_Lumpur = "Asia/Kuala_Lumpur",
  Asia_Manila = "Asia/Manila",
  Asia_Ho_Chi_Minh = "Asia/Ho_Chi_Minh",

  // East Asia
  Asia_Shanghai = "Asia/Shanghai",
  Asia_Hong_Kong = "Asia/Hong_Kong",
  Asia_Taipei = "Asia/Taipei",
  Asia_Tokyo = "Asia/Tokyo",
  Asia_Seoul = "Asia/Seoul",

  // Oceania
  Australia_Sydney = "Australia/Sydney",
  Australia_Melbourne = "Australia/Melbourne",
  Australia_Brisbane = "Australia/Brisbane",
  Australia_Adelaide = "Australia/Adelaide", // UTC+9:30/+10:30
  Australia_Perth = "Australia/Perth",
  Pacific_Auckland = "Pacific/Auckland",
  Pacific_Fiji = "Pacific/Fiji",
  Pacific_Honolulu = "Pacific/Honolulu",

  // North America (US/Canada)
  America_Toronto = "America/Toronto",
  America_New_York = "America/New_York",
  America_Chicago = "America/Chicago",
  America_Denver = "America/Denver",
  America_Los_Angeles = "America/Los_Angeles",
  America_Phoenix = "America/Phoenix", // No DST
  America_Anchorage = "America/Anchorage",
  America_Vancouver = "America/Vancouver",
  America_Mexico_City = "America/Mexico_City",
  America_Puerto_Rico = "America/Puerto_Rico",

  // Latin America
  America_Bogota = "America/Bogota",
  America_Lima = "America/Lima",
  America_Quito = "America/Quito",
  America_Caracas = "America/Caracas",
  America_Santiago = "America/Santiago",
  America_Buenos_Aires = "America/Argentina/Buenos_Aires",
  America_Sao_Paulo = "America/Sao_Paulo",
  America_Montevideo = "America/Montevideo",
}

export const DEFAULT_DATE_FORMAT = DateFormat.US;
export const DEFAULT_TIME_FORMAT = TimeFormat.TWELVE_HOUR;
export const DEFAULT_TIMEZONE = Timezone.UTC;

export const DATE_FORMAT_NAMES: Record<DateFormat, string> = {
  [DateFormat.US]: "MM/DD/YYYY (US)",
  [DateFormat.EU]: "DD/MM/YYYY (EU)",
  [DateFormat.ISO]: "YYYY-MM-DD (ISO)",
  [DateFormat.READABLE]: "DD MMM YYYY",
};

export const TIME_FORMAT_NAMES: Record<TimeFormat, string> = {
  [TimeFormat.TWELVE_HOUR]: "12-hour (AM/PM)",
  [TimeFormat.TWENTY_FOUR_HOUR]: "24-hour",
};

// Friendly labels for UI dropdowns
export const TIMEZONE_DISPLAY_NAMES: Array<{ value: Timezone; label: string; group: string }> = [
  { value: Timezone.UTC, label: "UTC", group: "Universal" },

  // Europe
  { value: Timezone.Europe_Lisbon, label: "Lisbon", group: "Europe" },
  { value: Timezone.Europe_London, label: "London", group: "Europe" },
  { value: Timezone.Europe_Paris, label: "Paris", group: "Europe" },
  { value: Timezone.Europe_Berlin, label: "Berlin", group: "Europe" },
  { value: Timezone.Europe_Madrid, label: "Madrid", group: "Europe" },
  { value: Timezone.Europe_Rome, label: "Rome", group: "Europe" },
  { value: Timezone.Europe_Amsterdam, label: "Amsterdam", group: "Europe" },
  { value: Timezone.Europe_Stockholm, label: "Stockholm", group: "Europe" },
  { value: Timezone.Europe_Athens, label: "Athens", group: "Europe" },
  { value: Timezone.Europe_Dublin, label: "Dublin", group: "Europe" },
  { value: Timezone.Europe_Prague, label: "Prague", group: "Europe" },
  { value: Timezone.Europe_Warsaw, label: "Warsaw", group: "Europe" },
  { value: Timezone.Europe_Bucharest, label: "Bucharest", group: "Europe" },
  { value: Timezone.Europe_Helsinki, label: "Helsinki", group: "Europe" },
  { value: Timezone.Europe_Moscow, label: "Moscow", group: "Europe" },
  { value: Timezone.Europe_Zurich, label: "Zurich", group: "Europe" },

  // Atlantic
  { value: Timezone.Atlantic_Azores, label: "Azores", group: "Atlantic" },
  { value: Timezone.Atlantic_Madeira, label: "Madeira", group: "Atlantic" },
  { value: Timezone.Atlantic_Canary, label: "Canary Islands", group: "Atlantic" },
  { value: Timezone.Atlantic_Cape_Verde, label: "Cape Verde", group: "Atlantic" },

  // Africa
  { value: Timezone.Africa_Casablanca, label: "Casablanca", group: "Africa" },
  { value: Timezone.Africa_Cairo, label: "Cairo", group: "Africa" },
  { value: Timezone.Africa_Lagos, label: "Lagos", group: "Africa" },
  { value: Timezone.Africa_Johannesburg, label: "Johannesburg", group: "Africa" },
  { value: Timezone.Africa_Nairobi, label: "Nairobi", group: "Africa" },
  { value: Timezone.Africa_Algiers, label: "Algiers", group: "Africa" },
  { value: Timezone.Africa_Abidjan, label: "Abidjan", group: "Africa" },
  { value: Timezone.Africa_Accra, label: "Accra", group: "Africa" },

  // Middle East
  { value: Timezone.Asia_Jerusalem, label: "Jerusalem", group: "Middle East" },
  { value: Timezone.Asia_Riyadh, label: "Riyadh", group: "Middle East" },
  { value: Timezone.Asia_Dubai, label: "Dubai", group: "Middle East" },
  { value: Timezone.Asia_Tehran, label: "Tehran", group: "Middle East" },
  { value: Timezone.Asia_Beirut, label: "Beirut", group: "Middle East" },
  { value: Timezone.Asia_Baghdad, label: "Baghdad", group: "Middle East" },
  { value: Timezone.Asia_Qatar, label: "Qatar", group: "Middle East" },

  // Asia
  { value: Timezone.Asia_Kolkata, label: "India (UTC+5:30)", group: "Asia" },
  { value: Timezone.Asia_Kathmandu, label: "Nepal (UTC+5:45)", group: "Asia" },
  { value: Timezone.Asia_Dhaka, label: "Dhaka", group: "Asia" },
  { value: Timezone.Asia_Yangon, label: "Myanmar (UTC+6:30)", group: "Asia" },
  { value: Timezone.Asia_Bangkok, label: "Bangkok", group: "Asia" },
  { value: Timezone.Asia_Jakarta, label: "Jakarta", group: "Asia" },
  { value: Timezone.Asia_Singapore, label: "Singapore", group: "Asia" },
  { value: Timezone.Asia_Kuala_Lumpur, label: "Kuala Lumpur", group: "Asia" },
  { value: Timezone.Asia_Manila, label: "Manila", group: "Asia" },
  { value: Timezone.Asia_Ho_Chi_Minh, label: "Ho Chi Minh", group: "Asia" },
  { value: Timezone.Asia_Shanghai, label: "Shanghai/Beijing", group: "Asia" },
  { value: Timezone.Asia_Hong_Kong, label: "Hong Kong", group: "Asia" },
  { value: Timezone.Asia_Taipei, label: "Taipei", group: "Asia" },
  { value: Timezone.Asia_Tokyo, label: "Tokyo", group: "Asia" },
  { value: Timezone.Asia_Seoul, label: "Seoul", group: "Asia" },

  // Oceania
  { value: Timezone.Australia_Perth, label: "Perth", group: "Oceania" },
  { value: Timezone.Australia_Adelaide, label: "Adelaide", group: "Oceania" },
  { value: Timezone.Australia_Brisbane, label: "Brisbane", group: "Oceania" },
  { value: Timezone.Australia_Sydney, label: "Sydney", group: "Oceania" },
  { value: Timezone.Australia_Melbourne, label: "Melbourne", group: "Oceania" },
  { value: Timezone.Pacific_Auckland, label: "Auckland", group: "Oceania" },
  { value: Timezone.Pacific_Fiji, label: "Fiji", group: "Oceania" },
  { value: Timezone.Pacific_Honolulu, label: "Honolulu", group: "Oceania" },

  // North America
  { value: Timezone.America_Anchorage, label: "Anchorage", group: "North America" },
  { value: Timezone.America_Los_Angeles, label: "Los Angeles (PT)", group: "North America" },
  { value: Timezone.America_Vancouver, label: "Vancouver", group: "North America" },
  { value: Timezone.America_Phoenix, label: "Phoenix (no DST)", group: "North America" },
  { value: Timezone.America_Denver, label: "Denver (MT)", group: "North America" },
  { value: Timezone.America_Chicago, label: "Chicago (CT)", group: "North America" },
  { value: Timezone.America_Mexico_City, label: "Mexico City", group: "North America" },
  { value: Timezone.America_New_York, label: "New York (ET)", group: "North America" },
  { value: Timezone.America_Toronto, label: "Toronto", group: "North America" },
  { value: Timezone.America_Puerto_Rico, label: "Puerto Rico", group: "North America" },

  // South America
  { value: Timezone.America_Caracas, label: "Caracas", group: "South America" },
  { value: Timezone.America_Bogota, label: "Bogotá", group: "South America" },
  { value: Timezone.America_Quito, label: "Quito", group: "South America" },
  { value: Timezone.America_Lima, label: "Lima", group: "South America" },
  { value: Timezone.America_Santiago, label: "Santiago", group: "South America" },
  { value: Timezone.America_Sao_Paulo, label: "São Paulo", group: "South America" },
  { value: Timezone.America_Buenos_Aires, label: "Buenos Aires", group: "South America" },
  { value: Timezone.America_Montevideo, label: "Montevideo", group: "South America" },
];

// Helper to render "GMT±X — City" at runtime (accounts for DST)
export function getTimezoneOffset(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: tz,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(now);
  const offset =
    parts.find((p) => p.type === "timeZoneName")?.value?.replace(/^UTC/, "GMT") ?? "GMT";
  return offset;
}

export function timezoneLabelWithOffset(tz: string, label: string): string {
  const offset = getTimezoneOffset(tz);
  return `${label} (${offset})`;
}

/**
 * Company Interest Guardrail Configuration (Stage 1)
 * Protects company interests by blocking harmful responses
 */
export interface CompanyInterestGuardrailConfig {
  enabled: boolean; // Default: true
  blockOffTopic: boolean; // Default: true (block completely off-topic responses)
  blockCompetitorInfo: boolean; // Default: true (block generic competitor information)
  blockFabrications: boolean; // Default: true (block fabricated products/policies)
  allowClarifications: boolean; // Default: true (allow AI to clarify its own terms)
}

/**
 * Confidence Guardrail Configuration (Stage 2)
 * Controls AI response fact grounding and confidence scoring
 */
export interface ConfidenceGuardrailConfig {
  highThreshold: number; // Default: 0.8 (minimum score for high confidence)
  mediumThreshold: number; // Default: 0.5 (minimum score for medium confidence)
  enableRecheck: boolean; // Default: true (enable automatic recheck for medium confidence)
  enableEscalation: boolean; // Default: true (enable human handoff for low confidence)
  fallbackMessage: string; // Message shown when escalation is disabled
  recheckConfig?: {
    maxDocuments: number; // Default: 10 (number of documents to retrieve on recheck)
    similarityThreshold: number; // Default: 0.3 (lower threshold for broader search)
  };
}

/**
 * Action Claim Guardrail Configuration (Stage 0)
 * Blocks responses that claim a state-changing action was performed
 * without a backing tool call in the same turn
 */
export interface ActionClaimGuardrailConfig {
  enabled: boolean; // Default: true
  maxRetries: number; // Default: 1 (corrective re-plans per turn before escalating)
  escalateOnFailure: boolean; // Default: true (HANDOFF vs fallback message when retries exhausted)
}

/**
 * Default company interest guardrail configuration
 */
export const DEFAULT_COMPANY_INTEREST_GUARDRAIL_CONFIG: CompanyInterestGuardrailConfig = {
  enabled: true,
  blockOffTopic: true,
  blockCompetitorInfo: true,
  blockFabrications: true,
  allowClarifications: true,
};

/**
 * Default confidence guardrail configuration
 */
export const DEFAULT_CONFIDENCE_GUARDRAIL_CONFIG: ConfidenceGuardrailConfig = {
  highThreshold: 0.8,
  mediumThreshold: 0.5,
  enableRecheck: true,
  enableEscalation: true,
  fallbackMessage:
    "I'm not confident I can provide an accurate answer to this question based on the available information. Let me connect you with a team member who can help.",
  recheckConfig: {
    maxDocuments: 10,
    similarityThreshold: 0.3,
  },
};

/**
 * Default action claim guardrail configuration
 */
export const DEFAULT_ACTION_CLAIM_GUARDRAIL_CONFIG: ActionClaimGuardrailConfig = {
  enabled: true,
  maxRetries: 1,
  escalateOnFailure: true,
};

/**
 * Action approval (D4-3 / D4-4): which AI write actions wait for a person.
 */
export interface ActionApprovalConfig {
  /**
   * Master switch: approval for AI write actions is on. Off = every call runs
   * (a playbook's own approval list still applies). Only the owner can turn it off.
   */
  moneyMovesNeedApproval: boolean;
  /** Refunds and discounts at or below this amount run without approval. 0 holds every one. */
  thresholdAmount: number;
  /**
   * Per write category: true = needs approval (D4-9). A missing category uses
   * the default: money moves (refund, cancel, discount, exchange) need approval,
   * the rest do not. Destructive tools and tools that do not declare a category
   * are always held.
   */
  categories: Partial<Record<ApprovalCategory, boolean>>;
  /**
   * The AI asks the shopper "shall I do it?" before a write action and only
   * proceeds after they answer (D4-10). Always on for cancels.
   */
  customerConfirmation: boolean;
  /** Roles that may approve or reject. The owner always can. */
  approverRoles: Array<"owner" | "admin" | "member" | "viewer" | "contributor" | "agent">;
  /** Hours a held action waits before the conversation is escalated to a person. */
  expiryHours: number;
}

/**
 * Write categories the owner can switch approval on or off for. Not
 * "destructive" or "other_write": those are always held while approval is on.
 */
export const APPROVAL_CATEGORIES = [
  "refund",
  "cancel",
  "discount",
  "exchange",
  "return",
  "address_change",
  "customer_update",
  "note",
] as const satisfies readonly WriteCategory[];

export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

export const DEFAULT_ACTION_APPROVAL_CONFIG: ActionApprovalConfig = {
  moneyMovesNeedApproval: true,
  thresholdAmount: 0,
  categories: {},
  customerConfirmation: true,
  approverRoles: ["owner", "admin"],
  expiryHours: 48,
};

/** The org's action approval settings with defaults filled in. */
export function resolveActionApprovalConfig(
  settings: OrganizationSettings | null | undefined,
): ActionApprovalConfig {
  return { ...DEFAULT_ACTION_APPROVAL_CONFIG, ...(settings?.actionApproval ?? {}) };
}

/**
 * AI disclosure label (D14-6/D14-7): the badge on AI replies in the widget and the
 * first-reply line on other channels. On everywhere by default. EU organizations
 * can rename it but not hide it (see services/ai-disclosure.ts).
 */
export interface AiDisclosureConfig {
  /** Custom label text. Empty or missing = the localized default ("AI assistant"). */
  label?: string | null;
  /** Channel ids ("web" = widget) where the label is hidden. Ignored for EU orgs. */
  hiddenChannels?: string[];
}

/**
 * Per-channel AI mode. Keyed by channel id ("web" or a channel plugin's
 * manifest `channel`). Missing = "on".
 * - "on": AI replies go out (subject to Require Approval).
 * - "drafts" (D14-7): the AI writes the reply and a person approves it before
 *   it is sent (the same queue as Require Approval / test mode).
 * - "off" (D7-14): the AI does not answer on this channel at all; shopper
 *   messages wait for the team. Lets a store go live on one channel first
 *   ("start on Web Chat only").
 */
export const CHANNEL_AI_MODES = ["on", "drafts", "off"] as const;
export type ChannelAiMode = (typeof CHANNEL_AI_MODES)[number];

export function resolveChannelAiMode(
  settings: OrganizationSettings | null | undefined,
  channel: string,
): ChannelAiMode {
  const mode = settings?.channelAiModes?.[channel];
  return mode && (CHANNEL_AI_MODES as readonly string[]).includes(mode) ? mode : "on";
}

/**
 * Customer files (D8-11/12/15). Missing values mean the defaults below, so
 * existing organizations read images unless they turned it off.
 */
export interface MediaSettings {
  /** The AI reads customer photos and PDFs (vision pass). Default on. */
  readImages?: boolean;
  /** The AI may see ID documents (owner only). Payment cards are never shown. Default off. */
  allowIdDocuments?: boolean;
  /** Where complete product-problem cases are emailed. Unset = Inbox only. */
  caseEmail?: string | null;
}

export function resolveMediaSettings(
  settings: OrganizationSettings | null | undefined,
): Required<MediaSettings> {
  const media = settings?.media;
  return {
    readImages: media?.readImages !== false,
    allowIdDocuments: media?.allowIdDocuments === true,
    caseEmail: typeof media?.caseEmail === "string" && media.caseEmail ? media.caseEmail : null,
  };
}

/**
 * Organization Settings JSONB structure
 * This type defines the complete structure of the settings field in the Organization entity
 */
export interface OrganizationSettings {
  testModeDefault?: boolean;
  companyDomain?: string; // Company's business domain/industry for context
  companyInterestGuardrail?: CompanyInterestGuardrailConfig; // Stage 1: Company interest protection
  confidenceGuardrail?: ConfidenceGuardrailConfig; // Stage 2: Fact grounding
  actionClaimGuardrail?: ActionClaimGuardrailConfig; // Stage 0: Action-claim vs tool-call consistency
  retentionDays?: number | null; // Data retention period in days (null = disabled/forever; new orgs start at DEFAULT_NEW_ORG_RETENTION_DAYS)
  isPlayground?: boolean; // Enables playground mode for public conversations (demo orgs only)
  llm?: OrgLlmConfig; // Per-org LLM chat provider + tier→model map (embeddings stay managed)
  aiRegion?: AiRegion; // Where AI calls are processed; "eu" routes everything to the EU endpoint
  actionApproval?: Partial<ActionApprovalConfig>; // Which AI write actions wait for a person
  aiDisclosure?: AiDisclosureConfig; // AI label on replies, per channel
  channelAiModes?: Record<string, ChannelAiMode>; // Per-channel AI mode; missing = "on"
  media?: MediaSettings; // Customer photos/PDFs: AI reading, ID documents, case email
  [key: string]: unknown;
}

/**
 * Retention for organizations created from now on (D14-8, Roger's D14 answer 7).
 * Existing organizations keep what they had (usually null = keep forever).
 */
export const DEFAULT_NEW_ORG_RETENTION_DAYS = 365;

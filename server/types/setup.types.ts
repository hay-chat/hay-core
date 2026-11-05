/**
 * In-app setup: what we asked the organization, and what its assistant can handle today.
 *
 * Stored answers live in `Organization.settings.setup`. Row statuses are worked out when the
 * board is read, so they always reflect real documents, connections and playbooks.
 */

export const BUSINESS_TYPES = ["store", "saas", "service", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Things a customer request can need from a connected platform. Plugins declare which they handle. */
export const SETUP_HANDLES = [
  "orders",
  "refunds",
  "order_changes",
  "billing",
  "subscriptions",
  "bookings",
] as const;
export type SetupHandle = (typeof SETUP_HANDLES)[number];

export const SETUP_PLUGIN_GROUPS = [
  "commerce",
  "payments",
  "crm",
  "helpdesk",
  "marketing",
  "knowledge",
  "booking",
] as const;
export type SetupPluginGroup = (typeof SETUP_PLUGIN_GROUPS)[number];

/** Optional `setup` block in a plugin's `hay-plugin` manifest. Core never names a plugin. */
export interface PluginSetupHints {
  businessTypes: BusinessType[];
  group: SetupPluginGroup;
  handles?: SetupHandle[];
}

export interface SetupSource {
  documentId: string;
  title: string;
  url?: string;
}

/** Result of asking whether this organization's documents really answer a question. */
export interface SetupCheckResult {
  /** `failed` means we could not check. It must never be shown as a missing answer. */
  outcome: "answered" | "not_answered" | "failed";
  answer?: string;
  sources: SetupSource[];
  checkedAt: string;
}

export interface SetupQuestion {
  id: string;
  text: string;
  source: "catalog" | "custom";
  /** Set when answering needs a connected platform rather than documents. */
  needs?: SetupHandle;
  /** The generated playbook for this request, once one exists. */
  playbookId?: string;
  /** Set when generating a playbook found no suitable tool or failed, so we never retry silently. */
  playbookAttempt?: { outcome: "no_tool" | "failed"; at: string };
  check?: SetupCheckResult;
}

export interface SetupSettings {
  businessType?: BusinessType;
  website?: string;
  /** Plugin ids the customer says they use. */
  toolPluginIds: string[];
  /** "webchat" or a plugin's manifest `channel` value. */
  channels: string[];
  questions: SetupQuestion[];
  answeredAt?: string;
  dismissedAt?: string;
  /** Set once the assistant's persona was filled in (or found already filled in). */
  assistantFilledAt?: string;
  /** Set only when every row, including platform rows, is ready. */
  finishedAt?: string;
}

export const SETUP_ROW_STATUSES = [
  "checking",
  "reading_site",
  "ready",
  "missing",
  "needs_connection",
  "playbook_off",
  "playbook_missing",
  "check_failed",
] as const;
export type SetupRowStatus = (typeof SETUP_ROW_STATUSES)[number];

export interface SetupPluginRef {
  id: string;
  name: string;
}

/** A channel the customer picked: "webchat", or a plugin's manifest `channel` value. */
export interface SetupChannelRef {
  id: string;
  name: string;
  /** The plugin that provides the channel. Absent for webchat, which core provides. */
  plugin?: SetupPluginRef;
  /** Whether that plugin is enabled for the organization. Meaningless for webchat. */
  connected: boolean;
}

export interface SetupRow {
  id: string;
  text: string;
  source: SetupQuestion["source"];
  status: SetupRowStatus;
  answer?: string;
  sources: SetupSource[];
  needs?: SetupHandle;
  /** The platform that can do this for the customer, when one was chosen. */
  plugin?: SetupPluginRef;
  playbook?: { id: string; title: string; steps: string[] };
  /** For `playbook_missing`: still to be generated, no suitable tool, or the attempt failed. */
  generation?: "pending" | "no_tool" | "failed";
}

export interface SetupSiteState {
  state: "none" | "reading" | "done" | "failed";
  sourceId?: string;
  website?: string;
  discovered: number;
  processed: number;
  total?: number;
  /**
   * True when reading stopped before the whole site was covered (a large site). `processed` is
   * then the pages read so far, and "not found" only means "not found in those pages".
   */
  partial?: boolean;
}

/** The single most useful thing to do next. */
export type SetupUpNext =
  | { kind: "connect"; plugin: SetupPluginRef; unlocks: number; capability?: SetupHandle }
  | { kind: "choose_platform"; unlocks: number; capability?: SetupHandle }
  | { kind: "playbook"; questionId: string; title: string }
  | { kind: "write_playbook"; questionId: string; text: string }
  | { kind: "answer"; questionId: string; text: string }
  | { kind: "done" };

export interface SetupBoard {
  businessType?: BusinessType;
  website?: string;
  toolPluginIds: string[];
  /** Names for `toolPluginIds`, so the header does not need the plugin list loaded. */
  toolPlugins: SetupPluginRef[];
  channels: string[];
  /** The channels the customer picked, resolved to names and connection state. */
  channelRefs: SetupChannelRef[];
  rows: SetupRow[];
  site: SetupSiteState;
  upNext: SetupUpNext;
  readyCount: number;
  totalCount: number;
  answeredAt?: string;
  dismissedAt?: string;
  finishedAt?: string;
  /** True when `/` should send this person to setup. */
  shouldPrompt: boolean;
}

export interface SetupSuggestions {
  questions: { id: string; text: string; needs?: SetupHandle }[];
  plugins: (SetupPluginRef & { group: SetupPluginGroup; handles: SetupHandle[] })[];
  channels: { id: string; name: string }[];
}

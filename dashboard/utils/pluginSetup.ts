/**
 * Pure helpers for the plugin settings page (D20). Core never names a plugin:
 * everything here works from what the plugin declares (manifest, config schema,
 * auth methods) and what the server resolved (config metadata).
 */

/** Capabilities the "What it can do" card can describe to a merchant. */
export const DESCRIBED_CAPABILITIES = [
  "messages",
  "customers",
  "mcp",
  "products",
  "disputes",
  "documents",
  "webchat",
] as const;
export type DescribedCapability = (typeof DESCRIBED_CAPABILITIES)[number];

/** Legacy object-shaped manifest capabilities, mapped to the SDK's array names. */
const LEGACY_CAPABILITY_KEYS: Record<string, DescribedCapability> = {
  chat_connector: "messages",
  mcp: "mcp",
  document_importer: "documents",
};

/**
 * Merchant-facing capabilities of a plugin, in a stable order. SDK manifests
 * declare an array (`["mcp", "auth"]`); older manifests an object keyed by
 * capability. Plumbing capabilities (auth, cron, config) are left out.
 */
export function describedCapabilities(capabilities: unknown): DescribedCapability[] {
  let names: string[] = [];
  if (Array.isArray(capabilities)) {
    names = capabilities.filter((name): name is string => typeof name === "string");
  } else if (capabilities && typeof capabilities === "object") {
    names = Object.keys(capabilities)
      .filter((key) => (capabilities as Record<string, unknown>)[key])
      .map((key) => LEGACY_CAPABILITY_KEYS[key] ?? key);
  }
  return DESCRIBED_CAPABILITIES.filter((capability) => names.includes(capability));
}

/** Per-field metadata the server resolves (config-resolver.ts). */
export interface ConfigFieldMeta {
  source: "env" | "database" | "default";
  canOverride: boolean;
  isEncrypted?: boolean;
  hasEnvFallback?: boolean;
  /** The server sets this value (its env var is set): "Managed by Hay.chat". */
  managed?: boolean;
  /** Belongs on the Advanced tab (declared advanced, or managed). */
  advanced?: boolean;
  envName?: string;
}

export interface ConfigFieldShape {
  required?: boolean;
  advanced?: boolean;
  showWhen?: {
    field: string;
    equals?: string | number | boolean;
    in?: Array<string | number | boolean>;
    notEquals?: string | number | boolean;
  };
}

export function isShown(field: ConfigFieldShape, values: Record<string, unknown>): boolean {
  const rule = field.showWhen;
  if (!rule) return true;
  const current = values[rule.field];
  if (rule.equals !== undefined && current !== rule.equals) return false;
  if (rule.notEquals !== undefined && current === rule.notEquals) return false;
  if (rule.in !== undefined && !rule.in.includes(current as never)) return false;
  return true;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Required fields the merchant still has to fill: shown (showWhen), not
 * managed by the server, and empty (a masked "********" secret counts as set).
 */
export function missingRequiredFields(
  schema: Record<string, ConfigFieldShape>,
  meta: Record<string, ConfigFieldMeta | undefined>,
  values: Record<string, unknown>,
): string[] {
  return Object.entries(schema)
    .filter(
      ([key, field]) =>
        field.required &&
        isShown(field, values) &&
        meta[key]?.source !== "env" &&
        isEmpty(values[key]),
    )
    .map(([key]) => key);
}

/**
 * Split the config schema into Setup fields (what the merchant fills in) and
 * Advanced fields (managed by the server, or declared technical). A required
 * advanced field that still has no value stays in Setup, so nothing the plugin
 * needs is ever hidden.
 */
export function splitConfigFields(
  schema: Record<string, ConfigFieldShape>,
  meta: Record<string, ConfigFieldMeta | undefined>,
  values: Record<string, unknown>,
): { setup: string[]; advanced: string[] } {
  const missing = new Set(missingRequiredFields(schema, meta, values));
  const setup: string[] = [];
  const advanced: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const isAdvanced = meta[key]?.advanced ?? (!!field.advanced || meta[key]?.source === "env");
    if (isAdvanced && !missing.has(key)) advanced.push(key);
    else setup.push(key);
  }
  return { setup, advanced };
}

/** The four states of the standard status contract (`GET /setup/status`). */
export type SetupState = "not_set_up" | "needs_action" | "connected" | "error";

export interface SetupSignals {
  enabled: boolean;
  channelFailing?: boolean;
  missingRequired: number;
  oauth?: { available: boolean; connected: boolean };
  /** MCP connection test, when one ran. */
  test?: { success: boolean; status?: string } | null;
  /** What the plugin reported itself through GET /setup/status, when it did. */
  reported?: SetupState | null;
}

/** Plugin status from what core knows, or what the plugin reported. */
export function deriveSetupState(signals: SetupSignals): SetupState {
  if (!signals.enabled) return "not_set_up";
  if (signals.channelFailing) return "error";
  if (signals.reported && signals.reported !== "not_set_up") return signals.reported;
  if (signals.test && !signals.test.success && signals.test.status !== "unconfigured") {
    return "error";
  }
  if (signals.missingRequired > 0) return "needs_action";
  if (signals.oauth?.available && !signals.oauth.connected) return "needs_action";
  if (signals.test?.status === "unconfigured") return "needs_action";
  if (signals.reported === "not_set_up") return "needs_action";
  return "connected";
}

/** A setup step as the plugin declares it (`register.setup`, served in metadata). */
export interface DeclaredSetupStep {
  id: string;
  kind: "fields" | "connect" | "component" | "external" | "verify";
  optional?: boolean;
  fields?: string[];
  component?: string;
  url?: string;
}

/** A step of the Setup tab checklist, ready to render. */
export interface ChecklistStep extends DeclaredSetupStep {
  optional: boolean;
  fields: string[];
}

export interface ChecklistInput {
  /** `metadata.setup.steps`, when the plugin declares them. */
  declared?: DeclaredSetupStep[];
  /** Setup-tab config fields, in schema order. */
  setupFields: string[];
  /** Plugin UI components in the before-settings / after-settings slots. */
  before: string[];
  after: string[];
  /** The plugin has an OAuth method (a Connect step makes sense). */
  hasConnect: boolean;
  /** The plugin can be tested (MCP). */
  hasVerify: boolean;
}

export interface Checklist {
  steps: ChecklistStep[];
  /** Components no declared step uses: rendered before / after the checklist. */
  extraBefore: string[];
  extraAfter: string[];
}

const step = (s: DeclaredSetupStep, fields: string[] = []): ChecklistStep => ({
  ...s,
  optional: !!s.optional,
  fields,
});

/**
 * The Setup checklist. A plugin that declares steps gets exactly those (minus
 * steps that cannot apply: no fields left, no OAuth method, unknown component),
 * plus a leading "details" step for setup fields no step claims. Otherwise core
 * builds the standard order: before-settings components, details, connect,
 * after-settings components, verify.
 */
export function buildSetupChecklist(input: ChecklistInput): Checklist {
  const { declared, setupFields, before, after, hasConnect, hasVerify } = input;

  if (!declared?.length) {
    const steps: ChecklistStep[] = [
      ...before.map((name) => step({ id: name, kind: "component", component: name })),
      ...(setupFields.length ? [step({ id: "details", kind: "fields" }, setupFields)] : []),
      ...(hasConnect ? [step({ id: "connect", kind: "connect" })] : []),
      ...after.map((name) => step({ id: name, kind: "component", component: name })),
      ...(hasVerify ? [step({ id: "verify", kind: "verify" })] : []),
    ];
    return { steps, extraBefore: [], extraAfter: [] };
  }

  const claimed = new Set(declared.flatMap((s) => (s.kind === "fields" ? (s.fields ?? []) : [])));
  const unclaimed = setupFields.filter((field) => !claimed.has(field));
  const hasCatchAll = declared.some((s) => s.kind === "fields" && !s.fields);
  const components = new Set([...before, ...after]);
  const used = new Set<string>();

  const steps: ChecklistStep[] = [];
  for (const s of declared) {
    if (s.kind === "fields") {
      const fields = (s.fields ?? unclaimed).filter((field) => setupFields.includes(field));
      if (fields.length) steps.push(step(s, fields));
    } else if (s.kind === "connect") {
      if (hasConnect) steps.push(step(s));
    } else if (s.kind === "verify") {
      if (hasVerify) steps.push(step(s));
    } else if (s.kind === "component") {
      if (s.component && components.has(s.component)) {
        used.add(s.component);
        steps.push(step(s));
      }
    } else {
      steps.push(step(s));
    }
  }
  if (unclaimed.length && !hasCatchAll) {
    steps.unshift(step({ id: "details", kind: "fields" }, unclaimed));
  }
  return {
    steps,
    extraBefore: before.filter((name) => !used.has(name)),
    extraAfter: after.filter((name) => !used.has(name)),
  };
}

export interface StepSignals {
  missingRequired: string[];
  oauthConnected: boolean;
  /** Last connection test: true / false, or null when none ran. */
  testSuccess: boolean | null;
  /** Per-step completion the plugin reported (`GET setupStatus`). */
  reported?: Record<string, { done: boolean; message?: string }>;
}

/** Whether a step is done: what the plugin reported, else what core can tell (null: unknown). */
export function isStepDone(s: ChecklistStep, signals: StepSignals): boolean | null {
  const reported = signals.reported?.[s.id];
  if (reported) return reported.done;
  if (s.kind === "fields") return !s.fields.some((field) => signals.missingRequired.includes(field));
  if (s.kind === "connect") return signals.oauthConnected;
  if (s.kind === "verify") return signals.testSuccess === true;
  return null;
}

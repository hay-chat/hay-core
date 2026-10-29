/**
 * Hay Plugin SDK - Setup Types
 *
 * A plugin declares the steps a merchant goes through to set it up, and can
 * report its own status. Core renders the steps as a numbered checklist on the
 * plugin's Setup tab and never learns what the plugin is.
 *
 * Step titles and descriptions are i18n keys, not strings: core reads
 * `setupSteps.<stepId>.title` (required) and `setupSteps.<stepId>.description`
 * (optional) from the plugin's `i18n/en.json` and `i18n/pt-BR.json`.
 *
 * @module @hay/plugin-sdk/types/setup
 */

import type { HayOrg } from "./org";
import type { HayConfigRuntimeAPI } from "./config";
import type { HayLogger } from "./logger";
import type { HayAuthRuntimeAPI } from "./auth";

/**
 * What a step asks of the merchant:
 * - `fields`: fill in config fields (`fields` lists them; default: every Setup field)
 * - `connect`: sign in through the plugin's OAuth method
 * - `component`: the plugin's own UI component (`component` names it)
 * - `external`: do something on another site (`url` links to it)
 * - `verify`: test the connection
 */
export type SetupStepKind = "fields" | "connect" | "component" | "external" | "verify";

export interface SetupStep {
  /** Stable id, lower-kebab or camelCase. Also the i18n key under `setupSteps`. */
  id: string;
  kind: SetupStepKind;
  /** Optional steps never block "Connected" (e.g. "Who gets notified"). */
  optional?: boolean;
  /** `fields` steps: the config fields this step shows. */
  fields?: string[];
  /** `component` steps: the UI component name (as in the manifest's ui slots). */
  component?: string;
  /** `external` steps: https link the merchant follows. */
  url?: string;
}

/** The four states of the standard status contract. */
export type SetupState = "not_set_up" | "needs_action" | "connected" | "error";

/** What `POST /setup/status` returns. */
export interface SetupStatus {
  state: SetupState;
  /** Who the plugin is connected as, e.g. a store domain or an account email. */
  account?: string;
  /** Per-step completion, keyed by step id. Steps left out are judged by core. */
  steps?: Record<string, { done: boolean; message?: string }>;
}

/** Context passed to the status handler (org-scoped, like a cron context). */
export interface HaySetupStatusContext {
  org: HayOrg;
  config: HayConfigRuntimeAPI;
  auth: HayAuthRuntimeAPI;
  logger: HayLogger;
}

export type SetupStatusHandler = (ctx: HaySetupStatusContext) => Promise<SetupStatus> | SetupStatus;

/** Options for `register.setup()`. */
export interface SetupOptions {
  steps: SetupStep[];
  /** Report the plugin's own status. Keep it fast: core gives it 5 seconds. */
  status?: SetupStatusHandler;
}

/** Serialisable setup descriptor exposed via `/metadata` (no handler). */
export interface SetupMetadata {
  steps: SetupStep[];
  hasStatus: boolean;
}

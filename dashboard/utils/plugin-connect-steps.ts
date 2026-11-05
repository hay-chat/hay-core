/**
 * Step model for the plugin Connect progress dialog. Mirrors the server's
 * `plugin:install-progress` events (server/lib/plugin-install-progress.ts).
 */
export const PLUGIN_INSTALL_PROGRESS_EVENT = "plugin:install-progress";

export const PLUGIN_CONNECT_STEPS = ["install", "build", "enable", "start"] as const;
export type PluginConnectStep = (typeof PLUGIN_CONNECT_STEPS)[number];

export type PluginConnectStepStatus = "pending" | "active" | "done" | "skipped" | "failed";

export interface PluginConnectStepState {
  key: PluginConnectStep;
  status: PluginConnectStepStatus;
  startedAt?: number;
  finishedAt?: number;
}

export interface PluginInstallProgressEvent {
  progressId: string;
  pluginId: string;
  step: PluginConnectStep;
  status: Exclude<PluginConnectStepStatus, "pending">;
}

export function isPluginInstallProgressEvent(value: unknown): value is PluginInstallProgressEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.progressId === "string" &&
    typeof event.pluginId === "string" &&
    PLUGIN_CONNECT_STEPS.includes(event.step as PluginConnectStep) &&
    ["active", "done", "skipped", "failed"].includes(event.status as string)
  );
}

export function initialConnectSteps(): PluginConnectStepState[] {
  return PLUGIN_CONNECT_STEPS.map((key) => ({ key, status: "pending" }));
}

/** Applies one server event. */
export function applyConnectEvent(
  steps: PluginConnectStepState[],
  step: PluginConnectStep,
  status: Exclude<PluginConnectStepStatus, "pending">,
  now: number,
): PluginConnectStepState[] {
  return steps.map((s) => {
    if (s.key !== step) return s;
    if (status === "active") return { ...s, status, startedAt: now, finishedAt: undefined };
    return { ...s, status, startedAt: s.startedAt ?? now, finishedAt: now };
  });
}

/** The request succeeded: whatever the socket did not report is finished. */
export function completeConnectSteps(
  steps: PluginConnectStepState[],
  now: number,
): PluginConnectStepState[] {
  return steps.map((s) =>
    s.status === "pending" || s.status === "active"
      ? { ...s, status: "done", startedAt: s.startedAt ?? now, finishedAt: now }
      : s,
  );
}

/**
 * The request failed: the running step (else the first unfinished one) is
 * marked failed, unless the server already marked one.
 */
export function failConnectSteps(
  steps: PluginConnectStepState[],
  now: number,
): PluginConnectStepState[] {
  if (steps.some((s) => s.status === "failed")) return steps;
  const target =
    steps.find((s) => s.status === "active") ?? steps.find((s) => s.status === "pending");
  if (!target) return steps;
  return steps.map((s) =>
    s.key === target.key
      ? { ...s, status: "failed", startedAt: s.startedAt ?? now, finishedAt: now }
      : s,
  );
}

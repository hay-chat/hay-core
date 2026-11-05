/**
 * Simulation conversations (D7-7): offline runs of the agent, made by the
 * simulation harness. They are test conversations (never billed, see
 * isTestConversation), and on top of that they are invisible: never delivered
 * to a channel, never broadcast, never alerted on, and left out of the Inbox,
 * Home, analytics and the orchestrator's sweeps.
 */

type Metadata = Record<string, unknown> | null | undefined;

export const SIMULATION_RUN_KIND = "simulation";

/**
 * Run kind of the in-app setup board's test turns. These runs are Hay's own readiness checks,
 * not something the customer started: they do not count against the monthly simulation
 * allowance, do not need any left, and are not listed with the customer's runs.
 */
export const SETUP_CHECK_RUN_KIND = "setup_check";

export function isSimulationConversation(metadata: Metadata): boolean {
  return metadata?.runKind === SIMULATION_RUN_KIND;
}

/**
 * SQL condition that leaves simulation conversations out, for a conversations
 * table aliased `alias`. A constant (no user input), safe to interpolate.
 */
export function notSimulationSql(alias: string): string {
  return `COALESCE(${alias}."metadata"->>'runKind', '') <> '${SIMULATION_RUN_KIND}'`;
}

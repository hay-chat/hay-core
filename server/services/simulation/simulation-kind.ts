/**
 * Simulation conversations (D7-7): offline runs of the agent, made by the
 * simulation harness. They are test conversations (never billed, see
 * isTestConversation), and on top of that they are invisible: never delivered
 * to a channel, never broadcast, never alerted on, and left out of the Inbox,
 * Home, analytics and the orchestrator's sweeps.
 */

type Metadata = Record<string, unknown> | null | undefined;

export const SIMULATION_RUN_KIND = "simulation";

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

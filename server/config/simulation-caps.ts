/**
 * Caps for simulation runs (D7-7): replays and simulations are free and never
 * billed, but capped per plan (Roger's answer 3, D7 research §9).
 *
 * Core knows no plans. The operator sets an organization's monthly allowance
 * through `internal.organizations.setLimits` into
 * `organization.limits.maxSimulationsPerMonth` (the Hay.chat backoffice derives
 * it from the plan's included resolutions); organizations without one
 * (self-hosted, or before the first sync) get the default below.
 */
export const SIMULATION_CAPS = {
  /** Simulated conversations per organization per calendar month (UTC). */
  defaultPerMonth: 200,
  /** Conversations in one run. */
  maxItemsPerRun: 200,
  /** Turns seeded into one simulated conversation. */
  maxSeedTurns: 200,
  /**
   * Conversations of one run in the orchestrator queue at the same time, so a
   * batch never starves live shoppers (the worker handles 2 messages at once).
   */
  concurrencyPerRun: 1,
  /** LLM tokens one run may spend; the rest of the run is skipped past this. */
  maxTokensPerRun: 3_000_000,
  /** A conversation running longer than this is marked failed by the sweep. */
  itemTimeoutMs: 10 * 60 * 1000,
} as const;

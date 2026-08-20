/**
 * Gate for the per-turn playbook selector.
 *
 * `RetrievalLayer.getPlaybookCandidate` re-scores every active playbook against the
 * whole transcript on a hard-tier, history-bearing call, and on most turns re-picks
 * the playbook already set. The planner is the only call that actually reads the
 * playbook, so it reports `playbookFits` and we gate the selector on that verdict —
 * turning a per-turn call into (ideally) one call per conversation.
 *
 * Kept free of orchestrator imports so it stays a pure, cheaply-testable predicate.
 *
 * @module orchestrator/playbook-gate
 */

/** The slice of Conversation this predicate needs. */
export interface PlaybookGateState {
  playbook_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** Key under `conversation.metadata` holding the planner's last verdict. */
export const PLAYBOOK_FITS_KEY = "playbookFits";

/**
 * Whether the playbook selector needs to run this turn.
 *
 * Runs when there is nothing to choose from is false (no active playbooks — the
 * selector no-ops anyway), when nothing is set yet, or when the planner's last turn
 * said the current playbook no longer fits. Otherwise the previous selection stands.
 */
export function shouldReselectPlaybook(
  conversation: PlaybookGateState,
  activePlaybookCount: number,
): boolean {
  if (activePlaybookCount === 0) return false;
  if (!conversation.playbook_id) return true;
  return conversation.metadata?.[PLAYBOOK_FITS_KEY] !== true;
}

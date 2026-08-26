/**
 * Playbook selection gating.
 *
 * The selector re-scores every active playbook against the whole transcript on a
 * hard-tier call. These tests pin the gate that keeps it from running on turns
 * where the planner already confirmed the current playbook fits.
 */
import { shouldReselectPlaybook } from "../../orchestrator/playbook-gate";
import type { PlaybookGateState } from "../../orchestrator/playbook-gate";

function conv(overrides: Partial<PlaybookGateState>): PlaybookGateState {
  return { playbook_id: null, metadata: null, ...overrides };
}

describe("shouldReselectPlaybook", () => {
  it("skips selection entirely when the org has no active playbooks", () => {
    expect(shouldReselectPlaybook(conv({ playbook_id: null }), 0)).toBe(false);
    expect(shouldReselectPlaybook(conv({ playbook_id: "pb-1" }), 0)).toBe(false);
  });

  it("selects on the first turn, when no playbook is set yet", () => {
    expect(shouldReselectPlaybook(conv({ playbook_id: null }), 3)).toBe(true);
  });

  it("selects when a playbook is set but the planner has not yet confirmed it", () => {
    expect(shouldReselectPlaybook(conv({ playbook_id: "pb-1", metadata: null }), 3)).toBe(true);
    expect(shouldReselectPlaybook(conv({ playbook_id: "pb-1", metadata: {} }), 3)).toBe(true);
  });

  it("skips selection once the planner confirmed the playbook fits", () => {
    expect(
      shouldReselectPlaybook(conv({ playbook_id: "pb-1", metadata: { playbookFits: true } }), 3),
    ).toBe(false);
  });

  it("selects again after the planner reported a mismatch", () => {
    expect(
      shouldReselectPlaybook(conv({ playbook_id: "pb-1", metadata: { playbookFits: false } }), 3),
    ).toBe(true);
  });

  it("ignores unrelated metadata already on the conversation", () => {
    expect(
      shouldReselectPlaybook(conv({ playbook_id: "pb-1", metadata: { somethingElse: true } }), 3),
    ).toBe(true);
  });
});

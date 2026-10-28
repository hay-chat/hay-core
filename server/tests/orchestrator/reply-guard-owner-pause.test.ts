import { describe, it, expect } from "@jest/globals";
import { getAiReplyBlocker } from "../../orchestrator/reply-guard";

/** The owner's "Pause AI everywhere" (D11-9) blocks every AI message, like the operator's pause. */
describe("getAiReplyBlocker with the owner's pause", () => {
  const base = { status: "open" as const, assigned_user_id: null, agent: { enabled: true } };

  it("blocks while the owner paused the AI", () => {
    expect(
      getAiReplyBlocker({ ...base, organization: { agentPausedAt: null, aiPausedAt: new Date() } }),
    ).toBe("organization_paused");
  });

  it("lets the AI speak once resumed", () => {
    expect(
      getAiReplyBlocker({ ...base, organization: { agentPausedAt: null, aiPausedAt: null } }),
    ).toBeNull();
  });
});

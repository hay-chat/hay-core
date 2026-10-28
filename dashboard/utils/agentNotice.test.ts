import { describe, expect, it } from "vitest";
import { agentNotice } from "./agentNotice";

describe("agentNotice", () => {
  it("reads the structured event, preferring the full name for staff", () => {
    expect(
      agentNotice({
        type: "System",
        metadata: {
          systemEvent: "agent_joined",
          agentFirstName: "Marina",
          userName: "Marina Souza",
        },
      }),
    ).toEqual({ key: "joined", name: "Marina Souza" });
    expect(
      agentNotice({ type: "System", metadata: { systemEvent: "agent_returned_to_ai" } }),
    ).toEqual({ key: "returnedToAi", name: null });
    expect(
      agentNotice({
        type: "System",
        metadata: { systemEvent: "agent_left", agentFirstName: "Marina" },
      }),
    ).toEqual({ key: "left", name: "Marina" });
  });

  it("understands takeover/release rows stored before the event existed", () => {
    expect(
      agentNotice({ type: "System", metadata: { isTakeoverMessage: true, userName: "Ana Lima" } }),
    ).toEqual({ key: "joined", name: "Ana Lima" });
    expect(
      agentNotice({ type: "System", metadata: { isReleaseMessage: true, returnToMode: "queue" } }),
    ).toEqual({ key: "left", name: null });
  });

  it("ignores every other message", () => {
    expect(agentNotice({ type: "System", metadata: null })).toBeNull();
    expect(agentNotice({ type: "System", metadata: { reason: "x" } })).toBeNull();
    expect(
      agentNotice({ type: "HumanAgent", metadata: { systemEvent: "agent_joined" } }),
    ).toBeNull();
  });
});

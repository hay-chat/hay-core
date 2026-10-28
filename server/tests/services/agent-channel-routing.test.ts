import { describe, it, expect } from "@jest/globals";
import { pickAgentForChannel, sharedChannels } from "../../services/agent-channel-routing";

/** D7-14: one responder per channel when several agents claim it. */
const agent = (id: string, day: number, channels: string[], enabled = true) => ({
  id,
  enabled,
  channels,
  created_at: new Date(`2026-10-0${day}T00:00:00Z`),
});

describe("pickAgentForChannel", () => {
  const oldest = agent("oldest", 1, ["whatsapp"]);
  const middle = agent("middle", 2, ["whatsapp", "instagram"]);
  const newest = agent("newest", 3, []);

  it("prefers the default agent among the agents assigned to the channel", () => {
    expect(pickAgentForChannel([newest, middle, oldest], "middle", "whatsapp")?.id).toBe("middle");
  });

  it("otherwise picks the oldest assigned agent, whatever the input order", () => {
    expect(pickAgentForChannel([newest, middle, oldest], "newest", "whatsapp")?.id).toBe("oldest");
  });

  it("skips disabled assigned agents", () => {
    const disabledOldest = { ...oldest, enabled: false };
    expect(pickAgentForChannel([disabledOldest, middle], null, "whatsapp")?.id).toBe("middle");
    // Nobody enabled: the orchestrator parks it for the team (paused agent).
    expect(pickAgentForChannel([disabledOldest], "gone", "whatsapp")?.id).toBe("oldest");
    expect(pickAgentForChannel([disabledOldest, newest], "newest", "whatsapp")?.id).toBe("newest");
  });

  it("falls back to the default agent, then the oldest enabled agent", () => {
    expect(pickAgentForChannel([newest, middle, oldest], "newest", "email")?.id).toBe("newest");
    expect(
      pickAgentForChannel([newest, middle, { ...oldest, enabled: false }], null, "email")?.id,
    ).toBe("middle");
    expect(pickAgentForChannel([], null, "email")).toBeNull();
  });
});

describe("sharedChannels", () => {
  it("lists channels claimed by several agents with the agent that answers", () => {
    const agents = [
      agent("a", 1, ["whatsapp", "web"]),
      agent("b", 2, ["whatsapp"]),
      agent("c", 3, ["web"]),
    ];
    expect(sharedChannels(agents, "c")).toEqual([
      { channel: "whatsapp", agentIds: ["a", "b"], responderId: "a" },
      { channel: "web", agentIds: ["a", "c"], responderId: "c" },
    ]);
  });
});

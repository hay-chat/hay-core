import { describe, it, expect } from "vitest";
import type { Message } from "@/types";
import { buildThread, currentHuman } from "../thread";

const at = (day: number, minute: number) => new Date(2026, 10, day, 14, minute).getTime();

let n = 0;
const msg = (partial: Partial<Message> & Pick<Message, "sender" | "timestamp">): Message => ({
  id: `m${++n}`,
  content: "text",
  metadata: {},
  ...partial,
});

const visitor = (timestamp: number) => msg({ sender: "user", agentType: "Customer", timestamp });
const ai = (timestamp: number) => msg({ sender: "agent", agentType: "BotAgent", timestamp });
const human = (timestamp: number, name = "Marina") =>
  msg({
    sender: "agent",
    agentType: "HumanAgent",
    timestamp,
    metadata: { agentFirstName: name, agentAvatarUrl: name === "Marina" ? "/m.png" : null },
  });
const joined = (timestamp: number) =>
  msg({
    sender: "agent",
    agentType: "System",
    content: "",
    timestamp,
    metadata: { systemEvent: "agent_joined", agentFirstName: "Marina" },
  });

const shape = (messages: Message[]) =>
  buildThread(messages).map((item) =>
    item.type === "group"
      ? `${item.author.kind}${item.author.kind === "human" ? `:${item.author.name}` : ""}x${item.messages.length}`
      : item.type,
  );

describe("buildThread", () => {
  it("groups consecutive messages from the same sender", () => {
    expect(shape([visitor(at(5, 1)), ai(at(5, 2)), ai(at(5, 2)), visitor(at(5, 3))])).toEqual([
      "day",
      "visitorx1",
      "aix2",
      "visitorx1",
    ]);
  });

  it("splits people by name and keeps join notices between groups", () => {
    expect(
      shape([ai(at(5, 1)), joined(at(5, 2)), human(at(5, 3)), human(at(5, 4), "Jonas")]),
    ).toEqual(["day", "aix1", "notice", "human:Marinax1", "human:Jonasx1"]);
  });

  it("starts a new group after a long pause and a divider on a new day", () => {
    expect(shape([ai(at(5, 1)), ai(at(5, 30)), ai(at(6, 31))])).toEqual([
      "day",
      "aix1",
      "aix1",
      "day",
      "aix1",
    ]);
  });

  it("shows no divider while only the greeting is there", () => {
    const greeting = { ...ai(at(5, 1)), isGreeting: true };
    expect(shape([greeting])).toEqual(["aix1"]);
  });

  it("skips System lines with nothing to show", () => {
    const empty = msg({ sender: "agent", agentType: "System", content: "", timestamp: at(5, 2) });
    expect(shape([ai(at(5, 1)), empty, ai(at(5, 3))])).toEqual(["day", "aix2"]);
  });

  it("carries the person's photo for the group avatar", () => {
    const group = buildThread([human(at(5, 1))])[1];
    expect(group).toMatchObject({ author: { kind: "human", name: "Marina", avatarUrl: "/m.png" } });
  });
});

describe("currentHuman", () => {
  it("is null while the AI answers", () => {
    expect(currentHuman([human(at(5, 1))], "BotAgent", "Marina Silva")).toBeNull();
  });

  it("is the latest person who replied or joined", () => {
    expect(currentHuman([human(at(5, 1), "Jonas"), joined(at(5, 2))], "HumanAgent", "x")).toEqual({
      name: "Marina",
      avatarUrl: null,
    });
    expect(currentHuman([human(at(5, 1))], "HumanAgent", undefined)).toEqual({
      name: "Marina",
      avatarUrl: "/m.png",
    });
  });

  it("falls back to the first word of the agent's name", () => {
    expect(currentHuman([], "HumanAgent", "Marina Silva")).toEqual({
      name: "Marina",
      avatarUrl: null,
    });
  });
});

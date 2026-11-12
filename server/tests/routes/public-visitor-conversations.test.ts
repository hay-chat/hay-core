import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

import { toVisitorConversationSummaries } from "@server/routes/v1/public-conversations/visitor-conversations";
import type { Conversation } from "@server/database/entities/conversation.entity";
import type { Message } from "@server/database/entities/message.entity";

const conv = (id: string, status: string) => ({ id, status }) as Conversation;
const msg = (overrides: Partial<Message>) =>
  ({
    id: "m",
    type: "Customer",
    content: "hi",
    created_at: new Date("2026-11-01T10:00:00Z"),
    metadata: null,
    ...overrides,
  }) as Message;

describe("toVisitorConversationSummaries", () => {
  const options = { assistantName: "Hay", resumableIds: new Set(["a"]) };

  it("names the sender the way the widget shows them", () => {
    const rows = toVisitorConversationSummaries(
      [conv("a", "human-took-over"), conv("b", "open"), conv("c", "closed")],
      new Map([
        [
          "a",
          msg({ type: "HumanAgent" as never, metadata: { agentFirstName: "Marina" } as never }),
        ],
        ["b", msg({ type: "Customer" as never, content: "Where is my order?" })],
        ["c", msg({ type: "BotAgent" as never, content: "x".repeat(300) })],
      ]),
      options,
    );

    expect(rows.map((r) => [r.id, r.status, r.lastSenderName, r.resumable])).toEqual([
      ["a", "open", "Marina", true],
      ["b", "open", null, false],
      ["c", "closed", "Hay", false],
    ]);
    expect(rows[2].lastMessagePreview).toHaveLength(140);
    expect(rows[2].lastMessagePreview.endsWith("…")).toBe(true);
  });

  it("shows no text for a files-only message and skips conversations with no message", () => {
    const rows = toVisitorConversationSummaries(
      [conv("a", "open"), conv("empty", "open")],
      new Map([
        [
          "a",
          msg({
            content: "[Customer sent a photo]",
            metadata: { mediaPlaceholder: true } as never,
          }),
        ],
      ]),
      options,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastMessagePreview).toBe("");
  });
});

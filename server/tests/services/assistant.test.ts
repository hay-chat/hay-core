import { describe, it, expect } from "@jest/globals";
import { buildAssistantInstructions } from "@server/services/assistant";
import type { TiptapDoc } from "@server/types/tiptap.types";

/** The organization is the assistant: its persona becomes the conversation's system message. */
describe("buildAssistantInstructions", () => {
  const empty = {
    assistantName: null,
    assistantTone: null,
    assistantAvoid: null,
    assistantInstructions: null,
  };

  it("returns null when the organization has not described its assistant", () => {
    expect(buildAssistantInstructions(empty)).toBeNull();
    expect(
      buildAssistantInstructions({ ...empty, assistantName: "  ", assistantTone: "" }),
    ).toBeNull();
  });

  it("writes name, tone, avoid and the Tiptap instructions, in that order", () => {
    const instructions: TiptapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Offer free returns." }] }],
    };

    const content = buildAssistantInstructions({
      ...empty,
      assistantName: "Ana",
      assistantTone: "warm",
      assistantAvoid: "jargon",
      assistantInstructions: instructions,
    });

    expect(content?.split("\n")).toEqual([
      "You are the assistant: Ana",
      "Your tone should be: warm",
      "You should avoid: jargon",
      expect.stringMatching(/^Here are some general instructions: .*Offer free returns\./),
    ]);
  });

  it("skips an empty instructions document", () => {
    expect(
      buildAssistantInstructions({
        ...empty,
        assistantName: "Ana",
        assistantInstructions: { type: "doc", content: [] },
      }),
    ).toBe("You are the assistant: Ana");
  });
});

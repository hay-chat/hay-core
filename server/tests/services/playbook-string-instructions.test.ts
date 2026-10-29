import { describe, it, expect } from "@jest/globals";
import { asTiptapDocument } from "../../services/playbook-instructions-text";
import { analyzeTiptapInstructions } from "../../utils/tiptap-formatter";

/**
 * The onboarding example playbooks are created with plain-text instructions.
 * Every reader expected a Tiptap doc and treated them as empty: the AI got no
 * instructions and the editor showed a blank body.
 */
describe("plain-text playbook instructions", () => {
  const text = "1. Ask for the order number.\n\n2. Look up the order.\n";

  it("become one paragraph per non-empty line", () => {
    expect(asTiptapDocument(text)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "1. Ask for the order number." }] },
        { type: "paragraph", content: [{ type: "text", text: "2. Look up the order." }] },
      ],
    });
  });

  it("reach the planner as text", () => {
    const doc = asTiptapDocument(text) as Parameters<typeof analyzeTiptapInstructions>[0];
    expect(analyzeTiptapInstructions(doc).formattedText).toContain("Look up the order.");
  });

  it("leave Tiptap documents untouched and empty values empty", () => {
    const doc = { type: "doc", content: [] };
    expect(asTiptapDocument(doc)).toBe(doc);
    expect(asTiptapDocument("  \n ")).toBeUndefined();
    expect(asTiptapDocument(null)).toBeUndefined();
    expect(asTiptapDocument([{ id: "a", level: 1, instructions: "Legacy step" }])).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Legacy step" }] }],
    });
  });
});

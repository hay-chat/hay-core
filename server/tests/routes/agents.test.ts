import { createAgentSchema, updateAgentSchema } from "@server/routes/v1/agents/index";
import { hasTiptapContent } from "@server/types/tiptap.types";

/**
 * Regression coverage for the agent instruction payload contract.
 *
 * The dashboard authors instructions in Tiptap and sends its document JSON
 * (`{ type: "doc", content: [...] }`) verbatim. These fields were once declared as
 * `z.array(z.unknown())`, which rejected every real payload — agent create and update
 * failed with a validation error for all users.
 */
describe("Agent route schemas", () => {
  const tiptapDoc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Escalate to a human." }] }],
  };

  describe("instruction fields accept Tiptap documents", () => {
    it("accepts the document the editor produces", () => {
      const result = createAgentSchema.safeParse({
        name: "Support agent",
        instructions: tiptapDoc,
        humanHandoffAvailableInstructions: tiptapDoc,
        humanHandoffUnavailableInstructions: tiptapDoc,
      });

      expect(result.success).toBe(true);
    });

    it("accepts an empty document from an untouched editor", () => {
      const result = createAgentSchema.safeParse({
        name: "Support agent",
        instructions: { type: "doc", content: [] },
      });

      expect(result.success).toBe(true);
    });

    it("accepts a null instructions field", () => {
      const result = createAgentSchema.safeParse({ name: "Support agent", instructions: null });

      expect(result.success).toBe(true);
    });

    it("applies to update as well as create", () => {
      const result = updateAgentSchema.safeParse({ instructions: tiptapDoc });

      expect(result.success).toBe(true);
    });
  });

  describe("instruction fields reject shapes that would corrupt the jsonb column", () => {
    it("rejects a bare array", () => {
      const result = createAgentSchema.safeParse({
        name: "Support agent",
        instructions: [{ type: "paragraph" }],
      });

      expect(result.success).toBe(false);
    });

    it("rejects legacy Editor.js data", () => {
      const result = createAgentSchema.safeParse({
        name: "Support agent",
        instructions: { blocks: [] },
      });

      expect(result.success).toBe(false);
    });
  });

  it("still requires a name", () => {
    expect(createAgentSchema.safeParse({ instructions: tiptapDoc }).success).toBe(false);
    expect(createAgentSchema.safeParse({ name: "", instructions: tiptapDoc }).success).toBe(false);
  });
});

/**
 * The orchestrator gates custom human-handoff behaviour on this predicate. It previously
 * used `Array.isArray(...)`, which is never true for a Tiptap document — so an agent's
 * configured escalation instructions were silently ignored and the default handoff ran.
 */
describe("hasTiptapContent", () => {
  it("is true for a document with authored content", () => {
    expect(hasTiptapContent({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
  });

  it("is false for an empty document from an untouched editor", () => {
    expect(hasTiptapContent({ type: "doc", content: [] })).toBe(false);
    expect(hasTiptapContent({ type: "doc" })).toBe(false);
  });

  it("is false when the column is unset", () => {
    expect(hasTiptapContent(null)).toBe(false);
    expect(hasTiptapContent(undefined)).toBe(false);
  });
});

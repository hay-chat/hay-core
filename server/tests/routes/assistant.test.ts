import { describe, it, expect } from "@jest/globals";
import { updateAssistantSchema } from "@server/routes/v1/organizations/assistant";
import { getDefaultScopesForRole, hasRequiredScope } from "@server/types/scopes";

/**
 * The assistant form sends Tiptap documents (`{ type: "doc", content: [...] }`)
 * verbatim; a stricter schema once rejected every real payload.
 */
describe("organizations.assistant.update input", () => {
  const tiptapDoc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Escalate to a human." }] }],
  };

  it("accepts the documents the editor produces, empty ones and nulls", () => {
    expect(
      updateAssistantSchema.safeParse({
        name: "Ana",
        instructions: tiptapDoc,
        humanHandoffAvailableInstructions: { type: "doc", content: [] },
        humanHandoffUnavailableInstructions: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a bare array for instructions", () => {
    expect(updateAssistantSchema.safeParse({ instructions: [{ type: "paragraph" }] }).success).toBe(
      false,
    );
  });

  it("takes one of the avatar presets", () => {
    expect(updateAssistantSchema.parse({ avatarPreset: "robot" })).toEqual({
      avatarPreset: "robot",
    });
    expect(updateAssistantSchema.safeParse({ avatarPreset: "unicorn" }).success).toBe(false);
  });

  it("no longer takes agent-only fields", () => {
    const parsed = updateAssistantSchema.parse({ name: "Ana", channels: ["web"], enabled: false });
    expect(parsed).toEqual({ name: "Ana" });
  });
});

describe("RBAC - assistant", () => {
  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["contributor", true, true],
    ["member", true, false],
    ["viewer", true, false],
    ["agent", false, false],
  ] as const)("%s: read %s, update %s", (role, canRead, canUpdate) => {
    const scopes = getDefaultScopesForRole(role);
    expect(hasRequiredScope("assistant", "read", scopes)).toBe(canRead);
    expect(hasRequiredScope("assistant", "update", scopes)).toBe(canUpdate);
  });
});

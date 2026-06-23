import { describe, it, expect } from "@jest/globals";
import {
  buildRepairMessages,
  injectSchemaIntoMessages,
  renderSchemaInstruction,
  validateJsonString,
} from "../../services/llm/structured-output";
import type { ChatMessage } from "../../services/llm/provider.types";

const SCHEMA = {
  type: "object",
  properties: { score: { type: "number" }, label: { type: "string" } },
  required: ["score", "label"],
  additionalProperties: false,
} as Record<string, unknown>;

describe("structured-output helpers", () => {
  describe("validateJsonString", () => {
    it("accepts schema-valid JSON", () => {
      const r = validateJsonString(SCHEMA, '{"score":0.9,"label":"ok"}');
      expect(r).toEqual({ valid: true, errors: "", parseError: false });
    });

    it("flags non-JSON with parseError", () => {
      const r = validateJsonString(SCHEMA, "not json at all");
      expect(r.valid).toBe(false);
      expect(r.parseError).toBe(true);
    });

    it("reports schema violations", () => {
      const r = validateJsonString(SCHEMA, '{"score":"high"}');
      expect(r.valid).toBe(false);
      expect(r.parseError).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });
  });

  describe("injectSchemaIntoMessages", () => {
    it("merges into an existing system message", () => {
      const msgs: ChatMessage[] = [
        { role: "system", content: "You are a bot." },
        { role: "user", content: "hi" },
      ];
      const out = injectSchemaIntoMessages(msgs, SCHEMA, "result");
      expect(out).toHaveLength(2);
      expect(out[0].role).toBe("system");
      expect(out[0].content).toContain("You are a bot.");
      expect(out[0].content).toContain("JSON Schema");
      // original is not mutated
      expect(msgs[0].content).toBe("You are a bot.");
    });

    it("prepends a system message when none exists", () => {
      const msgs: ChatMessage[] = [{ role: "user", content: "hi" }];
      const out = injectSchemaIntoMessages(msgs, SCHEMA);
      expect(out).toHaveLength(2);
      expect(out[0].role).toBe("system");
    });
  });

  it("renderSchemaInstruction embeds the schema and name", () => {
    const text = renderSchemaInstruction(SCHEMA, "myschema");
    expect(text).toContain("myschema");
    expect(text).toContain('"score"');
  });

  it("buildRepairMessages appends the bad output and a correction ask", () => {
    const original: ChatMessage[] = [{ role: "user", content: "q" }];
    const out = buildRepairMessages(original, '{"bad":1}', "missing label");
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ role: "assistant", content: '{"bad":1}' });
    expect(out[2].role).toBe("user");
    expect(out[2].content).toContain("missing label");
  });
});

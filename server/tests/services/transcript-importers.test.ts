import { describe, it, expect } from "@jest/globals";
import { parseCsv, parseGenericCsv } from "../../services/importers/transcripts/csv";
import { parsePastedTranscripts } from "../../services/importers/transcripts/paste";
import {
  normalizeTranscripts,
  TranscriptImportError,
} from "../../services/importers/transcripts/test-transcript";

/** D7-8: generic CSV and pasted transcripts into the neutral TestTranscript shape. */
describe("transcript importers", () => {
  describe("parseCsv", () => {
    it("handles quotes, doubled quotes, commas and newlines inside fields, CRLF and BOM", () => {
      const csv = '﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n1,2';
      expect(parseCsv(csv)).toEqual([
        ["a", "b"],
        ["x, y", 'say "hi"\nthere'],
        ["1", "2"],
      ]);
    });
  });

  describe("generic CSV", () => {
    it("groups rows by conversation, maps role aliases and keeps the order ref", () => {
      const csv = [
        "conversation_id,role,text,timestamp,order_ref",
        "c1,customer,Where is my order?,2026-10-01T10:00:00Z,",
        "c2,Visitor,Do you ship to Lisbon?,,",
        "c1,Atendente,Which order number?,2026-10-01T10:01:00Z,",
        'c1,customer,"#1001, please",2026-10-01T10:02:00Z,#1001',
      ].join("\n");
      const [c1, c2] = parseGenericCsv(csv);
      expect(c1).toMatchObject({ externalId: "c1", orderRef: "#1001" });
      expect(c1.turns.map((t) => [t.role, t.text])).toEqual([
        ["customer", "Where is my order?"],
        ["agent", "Which order number?"],
        ["customer", "#1001, please"],
      ]);
      expect(c1.turns[0].timestamp).toBe("2026-10-01T10:00:00.000Z");
      expect(c2.turns).toEqual([
        { role: "customer", text: "Do you ship to Lisbon?", timestamp: null },
      ]);
    });

    it("sorts a conversation by time only when every row has one", () => {
      const csv = [
        "conversation_id,role,text,timestamp",
        "c1,agent,Second,2026-10-01T10:05:00Z",
        "c1,customer,First,2026-10-01T10:00:00Z",
      ].join("\n");
      expect(parseGenericCsv(csv)[0].turns.map((t) => t.text)).toEqual(["First", "Second"]);
    });

    it("explains a missing column or an unknown role", () => {
      expect(() => parseGenericCsv("id,text\n1,hi")).toThrow(TranscriptImportError);
      expect(() => parseGenericCsv("conversation_id,role,text\nc1,robot,hi")).toThrow(
        /Row 2: role "robot"/,
      );
    });
  });

  describe("paste", () => {
    it("splits conversations on --- and keeps multi-line turns", () => {
      const pasted = [
        "Customer: Hi, where is my order?",
        "Agent: Can you send the order number?",
        "Cliente: #1001",
        "it was a gift",
        "---",
        "customer: Do you ship to Lisbon?",
      ].join("\n");
      const [first, second] = parsePastedTranscripts(pasted);
      expect(first.turns.map((t) => [t.role, t.text])).toEqual([
        ["customer", "Hi, where is my order?"],
        ["agent", "Can you send the order number?"],
        ["customer", "#1001\nit was a gift"],
      ]);
      expect(second.turns).toEqual([{ role: "customer", text: "Do you ship to Lisbon?" }]);
    });

    it("keeps a colon inside a message and splits on two blank lines", () => {
      const pasted = "Customer: Note: it's urgent\n\n\nCustomer: Another one";
      const result = parsePastedTranscripts(pasted);
      expect(result).toHaveLength(2);
      expect(result[0].turns[0].text).toBe("Note: it's urgent");
    });

    it("asks for role prefixes when a conversation has none", () => {
      expect(() => parsePastedTranscripts("hello there")).toThrow(TranscriptImportError);
    });
  });

  describe("normalize", () => {
    it("joins consecutive turns of one role and drops empty turns and transcripts", () => {
      const [only] = normalizeTranscripts([
        {
          turns: [
            { role: "customer", text: "Hi" },
            { role: "customer", text: "  " },
            { role: "customer", text: "Anyone?" },
            { role: "agent", text: "Hello!" },
          ],
        },
        { turns: [{ role: "agent", text: "" }] },
      ]);
      expect(only.turns.map((t) => [t.role, t.text])).toEqual([
        ["customer", "Hi\nAnyone?"],
        ["agent", "Hello!"],
      ]);
      expect(() => normalizeTranscripts([{ turns: [] }])).toThrow(/No conversations/);
    });
  });
});

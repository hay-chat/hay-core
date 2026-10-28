import { describe, it, expect } from "@jest/globals";
import { redactCardNumbers } from "../../services/media-analysis/redact";
import { toStoredAnalysis, withheldClass } from "../../services/media-analysis/privacy";
import { describeAttachmentForAgent } from "../../services/media-analysis/agent-view";
import { handoffTranscriptLine } from "../../orchestrator/conversation-utils";
import { MessageType } from "../../database/entities/message.entity";
import type { VisionResult } from "../../services/media-analysis/vision.service";

/** D8-12: ID and card images are withheld from the AI; card numbers never kept. */

const result = (extra: Partial<VisionResult> = {}): VisionResult => ({
  class: "receipt",
  sensitive: false,
  description: "Card receipt.",
  fields: {},
  answer: null,
  ...extra,
});

const IDS_OFF = { allowIdDocuments: false };
const IDS_ON = { allowIdDocuments: true };

describe("redactCardNumbers", () => {
  it("removes Luhn-valid card numbers, grouped or not", () => {
    expect(redactCardNumbers("Paid with 4111 1111 1111 1111 on 3/10")).toBe(
      "Paid with [card number removed] on 3/10",
    );
    expect(redactCardNumbers("card 5500-0000-0000-0004")).toBe("card [card number removed]");
    expect(redactCardNumbers("4012888888881881")).toBe("[card number removed]");
  });

  it("keeps order numbers, lot numbers and phone numbers", () => {
    const text = "Order 100245, lot L2309B, call +55 11 91234 5678, NF 0000123456789";
    expect(redactCardNumbers(text)).toBe(text);
  });
});

describe("withheldClass", () => {
  it("always withholds cards", () => {
    expect(withheldClass(result({ class: "card" }), IDS_OFF)).toBe("card");
    expect(withheldClass(result({ class: "card" }), IDS_ON)).toBe("card");
  });

  it("withholds ID documents unless the owner allowed them", () => {
    expect(withheldClass(result({ class: "id_document" }), IDS_OFF)).toBe("id_document");
    expect(withheldClass(result({ class: "id_document" }), IDS_ON)).toBeNull();
  });

  it("withholds anything flagged sensitive, as a card when IDs are allowed", () => {
    expect(withheldClass(result({ sensitive: true }), IDS_OFF)).toBe("id_document");
    expect(withheldClass(result({ sensitive: true }), IDS_ON)).toBe("card");
  });

  it("lets ordinary files through", () => {
    expect(withheldClass(result({ class: "damage" }), IDS_OFF)).toBeNull();
  });
});

describe("toStoredAnalysis", () => {
  it("keeps nothing of a withheld file", () => {
    const stored = toStoredAnalysis(
      result({ class: "card", description: "Visa ending 1111", fields: { amount: "R$ 10" } }),
      IDS_ON,
      "4111 1111 1111 1111",
    );
    expect(stored).toEqual({
      status: "done",
      class: "card",
      withheld: true,
      analyzedAt: expect.any(String),
    });
  });

  it("removes card numbers from description, fields and text", () => {
    const stored = toStoredAnalysis(
      result({
        description: "Receipt paid with 4111 1111 1111 1111.",
        fields: { invoice_number: "4111111111111111", amount: "R$ 59,90" },
      }),
      IDS_OFF,
      "Cartão 4111 1111 1111 1111\nTotal R$ 59,90",
    );
    expect(JSON.stringify(stored)).not.toContain("4111");
    expect(stored.fields).toEqual({ invoice_number: "[card number removed]", amount: "R$ 59,90" });
    expect(stored.text).toBe("Cartão [card number removed]\nTotal R$ 59,90");
  });
});

describe("what the AI and the handoff see of a withheld file", () => {
  const attachment = (cls: "id_document" | "card") => ({
    id: "11111111-1111-4111-8111-111111111111",
    name: "doc.jpg",
    url: "u",
    type: "image/jpeg",
    size: 1,
    analysis: { status: "done" as const, class: cls, withheld: true },
  });

  it("tells the AI an ID document was withheld", () => {
    expect(describeAttachmentForAgent(attachment("id_document"))).toContain(
      "ID document withheld for privacy",
    );
  });

  it("tells the AI never to ask for card details", () => {
    expect(describeAttachmentForAgent(attachment("card"))).toContain(
      "payment card image withheld for privacy. Never ask the customer for card details",
    );
  });

  it("keeps the handoff transcript free of the file's contents", () => {
    expect(
      handoffTranscriptLine({
        type: MessageType.CUSTOMER,
        content: "here",
        attachments: [attachment("card")],
      }),
    ).toBe("Customer: here [Attachments: doc.jpg (photo: withheld for privacy)]");
  });
});

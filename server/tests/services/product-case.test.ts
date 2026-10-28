import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D8-14: product-problem intake. Evidence checklist, the "case complete"
 * state on conversation metadata, and the template's guardrails.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const mockFindConversation = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdateConversation = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: {
    findById: (id: string) => mockFindConversation(id),
    update: (...args: unknown[]) => mockUpdateConversation(...args),
  },
}));

import { evaluateProductCase } from "@server/services/product-case/product-case";
import { listPlaybookTemplates } from "@server/services/product-case/templates";
import { completeProductCaseTool } from "@server/services/core/core-tools/complete-product-case";
import type { Conversation } from "@server/database/entities/conversation.entity";
import type { Message } from "@server/database/entities/message.entity";

const DAMAGE_PHOTO = {
  id: "p1",
  name: "leak.jpg",
  url: "u",
  type: "image/jpeg",
  size: 1,
  analysis: { status: "done", class: "damage", description: "Leaking.", fields: { lot_number: "L2309B" } },
};
const NOTA = {
  id: "n1",
  name: "nota.pdf",
  url: "u",
  type: "application/pdf",
  size: 1,
  analysis: { status: "done", class: "receipt", description: "Nota fiscal.", fields: {} },
};
const CARD_PHOTO = {
  id: "c1",
  name: "card.jpg",
  url: "u",
  type: "image/jpeg",
  size: 1,
  analysis: { status: "done", class: "card", withheld: true },
};

const customer = (attachments: unknown[]) =>
  ({ type: "Customer", content: "", attachments }) as unknown as Message;

const STORY = { howUsed: "Applied once a day on dry skin.", timeline: "Bought 2 Oct, opened 10 Oct, rash 12 Oct." };

describe("evaluateProductCase", () => {
  it("finds photos, lot number and invoice in what the AI read", () => {
    const result = evaluateProductCase([customer([DAMAGE_PHOTO, NOTA])], STORY);
    expect(result).toEqual({
      complete: true,
      evidence: {
        photoIds: ["p1"],
        lotNumber: "L2309B",
        invoiceAttachmentId: "n1",
        invoiceNumber: null,
        howUsed: STORY.howUsed,
        timeline: STORY.timeline,
      },
    });
  });

  it("lists every missing item", () => {
    expect(evaluateProductCase([], {})).toEqual({
      complete: false,
      missing: ["photos", "lot_number", "invoice", "how_used", "timeline"],
    });
  });

  it("accepts typed lot and invoice numbers", () => {
    const photo = { ...DAMAGE_PHOTO, analysis: { status: "done", class: "damage", fields: {} } };
    const result = evaluateProductCase([customer([photo])], {
      ...STORY,
      lotNumber: "B-77",
      invoiceNumber: "NF 4471",
    });
    expect(result).toMatchObject({ complete: true, evidence: { lotNumber: "B-77", invoiceNumber: "NF 4471" } });
  });

  it("never counts a withheld card photo, or a staff file, as evidence", () => {
    const staff = { type: "HumanAgent", content: "", attachments: [DAMAGE_PHOTO] } as unknown as Message;
    const result = evaluateProductCase([customer([CARD_PHOTO]), staff], { ...STORY, lotNumber: "L1", invoiceNumber: "1" });
    expect(result).toEqual({ complete: false, missing: ["photos"] });
  });
});

describe("complete_product_case core tool", () => {
  const conversation = (messages: Message[], metadata: Record<string, unknown> | null = null) =>
    ({ id: "conv-1", organization_id: "org-1", metadata, getMessages: async () => messages }) as unknown as Conversation;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindConversation.mockResolvedValue({ organization_id: "org-1", metadata: { url: "https://shop" } });
  });

  it("returns what is missing without changing the conversation", async () => {
    const result = await completeProductCaseTool.execute(conversation([customer([DAMAGE_PHOTO])]), {
      summary: "Leak",
      ...STORY,
    });
    expect(result).toEqual({ complete: false, missing: [expect.stringContaining("invoice")] });
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("marks the case complete on the conversation's metadata, keeping the rest", async () => {
    const result = await completeProductCaseTool.execute(conversation([customer([DAMAGE_PHOTO, NOTA])]), {
      summary: "Lotion bottle leaked; rash after use.",
      product: "Body lotion 200ml",
      ...STORY,
    });
    expect(result).toEqual({ complete: true });
    const [id, orgId, patch] = mockUpdateConversation.mock.calls[0] as [string, string, { metadata: Record<string, unknown> }];
    expect([id, orgId]).toEqual(["conv-1", "org-1"]);
    expect(patch.metadata.url).toBe("https://shop");
    expect(patch.metadata.productCase).toMatchObject({
      status: "complete",
      summary: "Lotion bottle leaked; rash after use.",
      product: "Body lotion 200ml",
      evidence: { photoIds: ["p1"], lotNumber: "L2309B" },
    });
  });

  it("does nothing when the case is already complete", async () => {
    const result = await completeProductCaseTool.execute(
      conversation([], { productCase: { status: "complete" } }),
      STORY,
    );
    expect(result).toEqual({ complete: true, alreadyComplete: true });
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });
});

describe("product-problem template", () => {
  it.each(["en", "pt-BR"] as const)("%s: has the health guardrail and the full checklist", (locale) => {
    const [template] = listPlaybookTemplates(locale);
    expect(template.id).toBe("product-problem");
    expect(template.instructions).toContain("complete_product_case");
    expect(template.instructions).toContain("inspect_attachment");
    expect(template.instructions).toMatch(locale === "en" ? /Never give medical/ : /Nunca dê orientação médica/);
    expect(template.instructions).toMatch(locale === "en" ? /lot or batch number/ : /número do lote/);
  });

  it("never claims approvals hold an action", () => {
    for (const locale of ["en", "pt-BR"] as const) {
      const [template] = listPlaybookTemplates(locale);
      expect(template.instructions).not.toMatch(/require approval|requires approval|on hold|held for/i);
    }
  });
});

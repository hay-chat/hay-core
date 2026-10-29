import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D8-15: a complete product case is emailed only to the address the merchant
 * configured, with signed links to the evidence (never withheld ID/card
 * images), and the outcome is stored on the case. SMTP is mocked.
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
const mockFindOrganization = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: (id: string) => mockFindOrganization(id) },
}));
const mockSend =
  jest.fn<(options: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>>();
jest.mock("@server/services/email.service", () => ({
  emailService: { sendTemplateEmail: (options: Record<string, unknown>) => mockSend(options) },
  getOrganizationLocale: async () => "pt",
}));

import { forwardProductCase, validCaseEmail } from "@server/services/product-case/forward";

const PHOTO = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "leak.jpg",
  url: "u",
  type: "image/jpeg",
  size: 1,
};
const CARD = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "card.jpg",
  url: "u",
  type: "image/jpeg",
  size: 1,
  analysis: { status: "done", class: "card", withheld: true },
};
const NOTA = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "nota.pdf",
  url: "u",
  type: "application/pdf",
  size: 1,
};

const PRODUCT_CASE = {
  status: "complete",
  completedAt: "2026-10-28T10:00:00.000Z",
  summary: "Bottle leaked on arrival.",
  product: "Body lotion",
  evidence: {
    // A withheld file id here must still never be linked.
    photoIds: [PHOTO.id, CARD.id],
    lotNumber: "L2309B",
    invoiceAttachmentId: NOTA.id,
    invoiceNumber: null,
    howUsed: "Not used yet.",
    timeline: "Arrived 27 Oct.",
  },
};

function conversation(metadata: Record<string, unknown> | null) {
  return {
    id: "conv-1",
    organization_id: "org-1",
    metadata,
    getMessages: async () => [{ type: "Customer", content: "", attachments: [PHOTO, CARD, NOTA] }],
  };
}

function savedCase(): Record<string, unknown> {
  const [, , patch] = mockUpdateConversation.mock.calls[0] as [
    string,
    string,
    { metadata: { productCase: Record<string, unknown> } },
  ];
  return patch.metadata.productCase;
}

describe("forwardProductCase", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindConversation.mockResolvedValue(conversation({ productCase: PRODUCT_CASE }));
    mockFindOrganization.mockResolvedValue({
      settings: { media: { caseEmail: "qualidade@loja.com.br" } },
    });
    mockSend.mockResolvedValue({ success: true });
  });

  it("emails the configured address with the evidence and signed links", async () => {
    const forward = await forwardProductCase("conv-1", "org-1");

    expect(forward).toEqual({
      status: "sent",
      to: "qualidade@loja.com.br",
      at: expect.any(String),
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const options = mockSend.mock.calls[0][0] as {
      to: string;
      locale: string;
      subject: string;
      variables: {
        details: Array<{ value: string }>;
        relatedItems: Array<{ text: string; url: string }>;
      };
    };
    expect(options.to).toBe("qualidade@loja.com.br");
    expect(options.locale).toBe("pt-BR");
    expect(options.subject).toContain("Body lotion");
    expect(options.variables.details.map((d) => d.value)).toEqual(
      expect.arrayContaining(["L2309B", "Not used yet.", "Arrived 27 Oct."]),
    );
    const links = options.variables.relatedItems;
    expect(links).toHaveLength(2);
    expect(links[0].url).toMatch(new RegExp(`/v1/media/${PHOTO.id}\\?.*sig=`));
    expect(links[1].url).toContain(NOTA.id);
    expect(JSON.stringify(links)).not.toContain(CARD.id);
    expect(savedCase().forward).toEqual(forward);
  });

  it("sends nothing when no address is configured", async () => {
    mockFindOrganization.mockResolvedValue({ settings: {} });
    const forward = await forwardProductCase("conv-1", "org-1");
    expect(forward).toEqual({ status: "not_configured", at: expect.any(String) });
    expect(mockSend).not.toHaveBeenCalled();
    expect(savedCase().forward).toEqual(forward);
  });

  it("sends nothing when the stored address is not a valid email", async () => {
    mockFindOrganization.mockResolvedValue({ settings: { media: { caseEmail: "not an email" } } });
    await expect(forwardProductCase("conv-1", "org-1")).resolves.toMatchObject({
      status: "not_configured",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing for another organization's conversation or an incomplete case", async () => {
    await expect(forwardProductCase("conv-1", "org-2")).resolves.toBeNull();
    mockFindConversation.mockResolvedValue(conversation({}));
    await expect(forwardProductCase("conv-1", "org-1")).resolves.toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });

  it("records a failed send", async () => {
    mockSend.mockResolvedValue({ success: false, error: "SMTP down" });
    await expect(forwardProductCase("conv-1", "org-1")).resolves.toMatchObject({
      status: "failed",
      error: "SMTP down",
    });
  });
});

describe("validCaseEmail", () => {
  it("accepts only a single valid address", () => {
    expect(validCaseEmail(" qa@shop.com ")).toBe("qa@shop.com");
    expect(validCaseEmail("a@b.com, c@d.com")).toBeNull();
    expect(validCaseEmail(null)).toBeNull();
  });
});

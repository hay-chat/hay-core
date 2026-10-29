import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Conversation.addDocument() only attaches a document of the conversation's
 * own organization (retrieval and playbooks hand it document ids).
 */

const mockUpdate = jest.fn<(id: string, orgId: string, data: Record<string, unknown>) => unknown>();
jest.mock("../../repositories/conversation.repository", () => ({
  conversationRepository: { update: mockUpdate },
}));

const mockFindDocument =
  jest.fn<(id: string, orgId: string) => Promise<Record<string, unknown> | null>>();
jest.mock("../../repositories/document.repository", () => ({
  documentRepository: { findByIdAndOrganization: mockFindDocument },
}));
jest.mock("../../database/data-source", () => ({ AppDataSource: {} }));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("../../lib/logger", () => ({ createLogger: () => mockLogger }));

import { Conversation } from "../../database/entities/conversation.entity";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "44444444-4444-4444-8444-444444444444";

function conversation(): Conversation {
  const c = new Conversation();
  c.id = "33333333-3333-4333-8333-333333333333";
  c.organization_id = ORG_ID;
  c.document_ids = [];
  c.addMessage = jest.fn(async () => ({})) as unknown as Conversation["addMessage"];
  return c;
}

describe("Conversation.addDocument", () => {
  beforeEach(() => jest.clearAllMocks());

  it("skips a document outside the conversation's organization", async () => {
    mockFindDocument.mockResolvedValue(null);
    const c = conversation();
    await c.addDocument(DOC_ID);
    expect(mockFindDocument).toHaveBeenCalledWith(DOC_ID, ORG_ID);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(c.addMessage).not.toHaveBeenCalled();
    expect(c.document_ids).toEqual([]);
  });

  it("attaches a document of the conversation's organization", async () => {
    mockFindDocument.mockResolvedValue({ id: DOC_ID, title: "Returns", content: "30 days" });
    const c = conversation();
    await c.addDocument(DOC_ID);
    expect(mockUpdate).toHaveBeenCalledWith(c.id, ORG_ID, { document_ids: [DOC_ID] });
    expect(c.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { documentId: DOC_ID, documentTitle: "Returns" } }),
    );
  });
});

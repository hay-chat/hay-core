import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D8-13: inspect_attachment re-reads a customer's file of THIS conversation
 * with a question, read-only, and honours the D8-12 withholding rules.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const mockFindOrganization = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: (id: string) => mockFindOrganization(id) },
}));
const mockLoad = jest.fn<(orgId: string, id: string) => Promise<unknown>>();
jest.mock("@server/services/media-analysis/pipeline", () => ({
  loadFileForVision: (orgId: string, id: string) => mockLoad(orgId, id),
}));
const mockAnalyze = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@server/services/media-analysis/vision.service", () => ({
  visionService: { analyze: (...args: unknown[]) => mockAnalyze(...args) },
}));

import { inspectAttachmentTool } from "@server/services/core/core-tools/inspect-attachment";
import type { Conversation } from "@server/database/entities/conversation.entity";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const photo = (analysis?: Record<string, unknown>) => ({
  id: FILE_ID,
  name: "label.jpg",
  url: "u",
  type: "image/jpeg",
  size: 1,
  ...(analysis ? { analysis } : {}),
});

function conversationWith(messages: unknown[]): Conversation {
  return {
    id: "c1",
    organization_id: "org-1",
    getMessages: async () => messages,
  } as unknown as Conversation;
}

const reply = (extra: Record<string, unknown> = {}) => ({
  class: "product",
  sensitive: false,
  description: "A bottle label.",
  fields: { lot_number: "L2309B" },
  answer: "The lot number is L2309B.",
  ...extra,
});

const ask = (conversation: Conversation, attachmentId = FILE_ID) =>
  inspectAttachmentTool.execute(conversation, {
    attachmentId,
    question: "What is the lot number?",
  });

describe("inspect_attachment core tool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrganization.mockResolvedValue({ settings: {} });
    mockLoad.mockResolvedValue({
      input: { kind: "image", buffer: Buffer.from(""), mimeType: "image/jpeg" },
    });
    mockAnalyze.mockResolvedValue(reply());
  });

  it("answers a question about the customer's photo", async () => {
    const conversation = conversationWith([
      { type: "Customer", content: "", attachments: [photo()] },
    ]);
    await expect(ask(conversation)).resolves.toEqual({
      answer: "The lot number is L2309B.",
      class: "product",
      fields: { lot_number: "L2309B" },
    });
    expect(mockLoad).toHaveBeenCalledWith("org-1", FILE_ID);
    expect(mockAnalyze).toHaveBeenCalledWith("org-1", expect.anything(), "What is the lot number?");
  });

  it("only reads files the customer sent in this conversation", async () => {
    const staffFile = conversationWith([
      { type: "HumanAgent", content: "", attachments: [photo()] },
    ]);
    await expect(ask(staffFile)).resolves.toEqual({ error: expect.stringContaining("no photo") });
    const empty = conversationWith([]);
    await expect(ask(empty, "22222222-2222-4222-8222-222222222222")).resolves.toEqual({
      error: expect.stringContaining("no photo"),
    });
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it("refuses when image reading is off", async () => {
    mockFindOrganization.mockResolvedValue({ settings: { media: { readImages: false } } });
    const conversation = conversationWith([
      { type: "Customer", content: "", attachments: [photo()] },
    ]);
    await expect(ask(conversation)).resolves.toEqual({
      error: "image reading is turned off for this store",
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("refuses a file already withheld for privacy", async () => {
    const conversation = conversationWith([
      {
        type: "Customer",
        content: "",
        attachments: [photo({ status: "done", class: "card", withheld: true })],
      },
    ]);
    await expect(ask(conversation)).resolves.toEqual({
      error: "this file is withheld for privacy",
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("refuses when the new look finds an ID document, unless the owner allowed IDs", async () => {
    const conversation = conversationWith([
      { type: "Customer", content: "", attachments: [photo()] },
    ]);
    mockAnalyze.mockResolvedValue(reply({ class: "id_document", answer: "RG 12.345.678-9" }));
    await expect(ask(conversation)).resolves.toEqual({
      error: "this file is withheld for privacy",
    });

    mockFindOrganization.mockResolvedValue({ settings: { media: { allowIdDocuments: true } } });
    await expect(ask(conversation)).resolves.toMatchObject({ class: "id_document" });
  });

  it("removes card numbers from the answer", async () => {
    const conversation = conversationWith([
      { type: "Customer", content: "", attachments: [photo()] },
    ]);
    mockAnalyze.mockResolvedValue(
      reply({ class: "receipt", answer: "Paid with 4111 1111 1111 1111" }),
    );
    await expect(ask(conversation)).resolves.toMatchObject({
      answer: "Paid with [card number removed]",
    });
  });
});

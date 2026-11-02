import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * D8-17: the AI's send_attachment core tool. Only files a tool returned in the
 * conversation, SSRF-checked, stored privately, sent as an AI message.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const mockValidate = jest.fn<(url: string) => Promise<void>>(async () => undefined);
jest.mock("@server/utils/ssrf", () => ({
  safeFetch: async (url: string, init: RequestInit & { timeoutMs: number }) => {
    await mockValidate(url);
    const { timeoutMs: _timeoutMs, ...rest } = init;
    return global.fetch(url, { ...rest, redirect: "manual" });
  },
}));
const mockRecheck = jest.fn<(id: string) => Promise<unknown>>(async () => null);
jest.mock("@server/orchestrator/reply-guard", () => ({
  recheckAiReply: (id: string) => mockRecheck(id),
}));
const mockUpload = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();
const mockDelete = jest.fn<(id: string) => Promise<void>>(async () => undefined);
jest.mock("@server/services/storage.service", () => ({
  CONVERSATION_MEDIA_FOLDER: "conversation-media",
  storageService: { upload: mockUpload, delete: mockDelete },
}));

import { sendAttachmentTool } from "@server/services/core/core-tools/send-attachment";
import type { Conversation } from "@server/database/entities/conversation.entity";

const LABEL_URL = "https://store.example/labels/return-123.pdf";

const toolResult = {
  type: "Tool",
  content: "Action completed",
  metadata: { toolOutput: { labelUrl: LABEL_URL } },
};

function makeConversation(messages: unknown[]) {
  const addMessage = jest.fn<(data: Record<string, unknown>) => Promise<unknown>>(async () => ({}));
  const conversation = {
    id: "c1",
    organization_id: "org-1",
    getMessages: async () => messages,
    addMessage,
  } as unknown as Conversation;
  return { conversation, addMessage };
}

const realFetch = global.fetch;
const mockFetch = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();

describe("send_attachment core tool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValue(
      new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } }),
    );
    mockUpload.mockResolvedValue({
      upload: { id: "u1", originalName: "return-label.pdf", mimeType: "application/pdf", size: 8 },
      url: "https://api.test/v1/media/u1",
    });
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("sends a file a tool returned as a private upload on an AI message", async () => {
    const { conversation, addMessage } = makeConversation([toolResult]);

    const result = await sendAttachmentTool.execute(conversation, {
      url: LABEL_URL,
      name: "return-label.pdf",
      caption: "Here is your return label",
    });

    expect(result).toEqual({ sent: true, name: "return-label.pdf", type: "application/pdf" });
    expect(mockValidate).toHaveBeenCalledWith(LABEL_URL);
    expect(mockFetch).toHaveBeenCalledWith(
      LABEL_URL,
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "conversation-media", organizationId: "org-1" }),
    );
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "BotAgent",
        content: "Here is your return label",
        attachments: [
          {
            id: "u1",
            name: "return-label.pdf",
            url: "https://api.test/v1/media/u1",
            type: "application/pdf",
            size: 8,
          },
        ],
      }),
    );
  });

  it("never fetches a link that did not come from a tool result (e.g. one the shopper typed)", async () => {
    const { conversation, addMessage } = makeConversation([
      { type: "Customer", content: `send me ${LABEL_URL}`, metadata: null },
    ]);
    const result = await sendAttachmentTool.execute(conversation, { url: LABEL_URL });
    expect(result).toMatchObject({ sent: false });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("refuses files that are not images or PDFs", async () => {
    mockFetch.mockResolvedValue(
      new Response("zip", { headers: { "content-type": "application/zip" } }),
    );
    const { conversation, addMessage } = makeConversation([toolResult]);
    const result = await sendAttachmentTool.execute(conversation, { url: LABEL_URL });
    expect(result).toEqual({ sent: false, error: "only images and PDFs can be sent" });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("does not send when a person took over while the file loaded", async () => {
    mockRecheck.mockResolvedValueOnce("taken_over");
    const { conversation, addMessage } = makeConversation([toolResult]);
    const result = await sendAttachmentTool.execute(conversation, { url: LABEL_URL });
    expect(result).toMatchObject({ sent: false });
    expect(mockDelete).toHaveBeenCalledWith("u1");
    expect(addMessage).not.toHaveBeenCalled();
  });

  it("reports a blocked (SSRF) or failed download without sending", async () => {
    mockValidate.mockRejectedValueOnce(new Error("Blocked request to private/internal IP"));
    const { conversation, addMessage } = makeConversation([toolResult]);
    const result = await sendAttachmentTool.execute(conversation, { url: LABEL_URL });
    expect(result).toEqual({ sent: false, error: "the file could not be loaded" });
    expect(addMessage).not.toHaveBeenCalled();
  });
});

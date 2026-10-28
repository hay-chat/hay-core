import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D8-16: a person who took over sends files from the Inbox composer. Upload
 * first (`uploadAttachment`), then `sendMessage` with the upload ids; the
 * message only takes that person's unsent uploads in the same organization.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

type FakeConversation = {
  id: string;
  organization_id: string;
  status: string;
  assigned_user_id: string | null;
  addMessage: jest.Mock<(data: Record<string, unknown>) => Promise<unknown>>;
};
let conversation: FakeConversation;

jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({ findById: async () => conversation })),
}));
jest.mock("@server/repositories/user.repository", () => ({
  userRepository: { findById: async () => ({ firstName: "Marina", getFullName: () => "M" }) },
}));

const mockUpload = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();
jest.mock("@server/services/storage.service", () => ({
  CONVERSATION_MEDIA_FOLDER: "conversation-media",
  storageService: {
    upload: mockUpload,
    getUrl: (upload: { id: string }) => `https://api.test/v1/media/${upload.id}`,
  },
}));

const mockUploadFind = jest.fn<(options: { where: Record<string, unknown> }) => Promise<unknown>>();
jest.mock("@server/entities/upload.entity", () => ({ Upload: { find: mockUploadFind } }));

import { conversationsRouter } from "@server/routes/v1/conversations";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444";

const ctx = {
  user: { id: USER_ID, hasScope: () => true, getRole: () => "owner" },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;
const caller = () => conversationsRouter.createCaller(ctx);

const takenOver = () => {
  conversation.status = "human-took-over";
  conversation.assigned_user_id = USER_ID;
};

describe("Inbox composer attachments (D8-16)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    conversation = {
      id: CONVERSATION_ID,
      organization_id: ORG_ID,
      status: "open",
      assigned_user_id: null,
      addMessage: jest.fn(async (data: Record<string, unknown>) => ({ id: "m1", ...data })),
    };
  });

  it("stores a picked file as private conversation media of the person who took over", async () => {
    takenOver();
    mockUpload.mockResolvedValue({
      upload: { id: UPLOAD_ID, mimeType: "image/png", size: 3 },
      url: `https://api.test/v1/media/${UPLOAD_ID}`,
    });

    const result = await caller().uploadAttachment({
      conversationId: CONVERSATION_ID,
      data: Buffer.from("png").toString("base64"),
      mimeType: "image/png",
      fileName: "../label.png",
    });

    expect(result).toEqual({
      id: UPLOAD_ID,
      name: "label.png",
      url: `https://api.test/v1/media/${UPLOAD_ID}`,
      type: "image/png",
      size: 3,
    });
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: "conversation-media",
        organizationId: ORG_ID,
        uploadedById: USER_ID,
      }),
    );
  });

  it("refuses uploads before the person took over", async () => {
    await expect(
      caller().uploadAttachment({
        conversationId: CONVERSATION_ID,
        data: "cG5n",
        mimeType: "image/png",
        fileName: "a.png",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("sends a file-only message with the person's own unsent upload", async () => {
    takenOver();
    mockUploadFind.mockResolvedValue([
      { id: UPLOAD_ID, originalName: "label.png", mimeType: "image/png", size: 3 },
    ]);

    await caller().sendMessage({
      conversationId: CONVERSATION_ID,
      content: "",
      role: "assistant",
      attachmentIds: [UPLOAD_ID],
    });

    expect(mockUploadFind.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG_ID,
      uploadedById: USER_ID,
      folder: "conversation-media",
    });
    expect(conversation.addMessage.mock.calls[0][0]).toMatchObject({
      type: "HumanAgent",
      content: "",
      attachments: [
        {
          id: UPLOAD_ID,
          name: "label.png",
          url: `https://api.test/v1/media/${UPLOAD_ID}`,
          type: "image/png",
          size: 3,
        },
      ],
    });
  });

  it("refuses an upload that is not the person's unsent file", async () => {
    takenOver();
    mockUploadFind.mockResolvedValue([]);
    await expect(
      caller().sendMessage({
        conversationId: CONVERSATION_ID,
        content: "here",
        role: "assistant",
        attachmentIds: [UPLOAD_ID],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(conversation.addMessage).not.toHaveBeenCalled();
  });

  it("refuses files on a message when the person has not taken over", async () => {
    await expect(
      caller().sendMessage({
        conversationId: CONVERSATION_ID,
        content: "",
        role: "assistant",
        attachmentIds: [UPLOAD_ID],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("still refuses an empty message without files", async () => {
    takenOver();
    await expect(
      caller().sendMessage({ conversationId: CONVERSATION_ID, content: "  ", role: "assistant" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

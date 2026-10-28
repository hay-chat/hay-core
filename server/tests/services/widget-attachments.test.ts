import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D8-9: files a shopper sends from the widget, and how attachments reach the
 * widget (signed links only).
 */

jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockUpload = jest.fn<(options: Record<string, unknown>) => Promise<unknown>>();
const mockDelete = jest.fn<(id: string) => Promise<void>>(async () => undefined);
jest.mock("@server/services/storage.service", () => ({
  CONVERSATION_MEDIA_FOLDER: "conversation-media",
  storageService: { upload: mockUpload, delete: mockDelete },
}));

const mockSign = jest.fn(async (attachments: Array<{ id?: string; url: string }>) =>
  attachments.map((attachment) =>
    attachment.id === "11111111-1111-4111-8111-111111111111"
      ? { ...attachment, url: `${attachment.url}?expires=1&sig=abc` }
      : attachment,
  ),
);
jest.mock("@server/services/media-url.service", () => ({
  signAttachmentUrls: (attachments: Array<{ id?: string; url: string }>) => mockSign(attachments),
}));

import {
  WIDGET_ATTACHMENT_MAX_BYTES,
  WidgetAttachmentRejectedError,
  cleanFilename,
  describeCustomerAttachments,
  storeWidgetAttachment,
} from "@server/services/webchat/widget-attachments";
import { toPublicAttachments } from "@server/services/webchat/public-message";

const ORG = "22222222-2222-4222-8222-222222222222";

describe("describeCustomerAttachments", () => {
  it("names what the shopper sent", () => {
    expect(describeCustomerAttachments([{ name: "a.jpg", type: "image/jpeg" }])).toBe(
      "[Customer sent a photo]",
    );
    expect(describeCustomerAttachments([{ name: "invoice.pdf", type: "application/pdf" }])).toBe(
      "[Customer sent a PDF: invoice.pdf]",
    );
    expect(
      describeCustomerAttachments([
        { name: "a.jpg", type: "image/jpeg" },
        { name: "b.png", type: "image/png" },
      ]),
    ).toBe("[Customer sent 2 photos]");
  });
});

describe("cleanFilename", () => {
  it("drops paths and control characters, and falls back by type", () => {
    expect(cleanFilename("../../etc/passwd", "image/png")).toBe("passwd");
    expect(cleanFilename("C:\\Users\\me\\photo.jpg", "image/jpeg")).toBe("photo.jpg");
    expect(cleanFilename("bad\u0000name.pdf", "application/pdf")).toBe("badname.pdf");
    expect(cleanFilename("   ", "application/pdf")).toBe("document.pdf");
  });
});

describe("storeWidgetAttachment", () => {
  beforeEach(() => jest.clearAllMocks());

  const stored = (mimeType: string) => ({
    upload: { id: "u1", mimeType, size: 3 },
    url: "https://api.test/v1/media/u1",
  });

  it("stores a photo as conversation media of the conversation's organization, capped at 10 MB", async () => {
    mockUpload.mockResolvedValueOnce(stored("image/jpeg"));
    const attachment = await storeWidgetAttachment({
      organizationId: ORG,
      buffer: Buffer.from("abc"),
      mimeType: "image/jpeg",
      filename: "photo.jpg",
    });
    expect(attachment).toEqual({
      id: "u1",
      name: "photo.jpg",
      url: "https://api.test/v1/media/u1",
      type: "image/jpeg",
      size: 3,
    });
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: "conversation-media",
        organizationId: ORG,
        maxSize: WIDGET_ATTACHMENT_MAX_BYTES,
      }),
    );
  });

  it("refuses other types and files over 10 MB before storing", async () => {
    await expect(
      storeWidgetAttachment({
        organizationId: ORG,
        buffer: Buffer.from("abc"),
        mimeType: "video/mp4",
        filename: "clip.mp4",
      }),
    ).rejects.toBeInstanceOf(WidgetAttachmentRejectedError);
    await expect(
      storeWidgetAttachment({
        organizationId: ORG,
        buffer: Buffer.alloc(WIDGET_ATTACHMENT_MAX_BYTES + 1),
        mimeType: "image/png",
        filename: "big.png",
      }),
    ).rejects.toBeInstanceOf(WidgetAttachmentRejectedError);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("removes a file whose content turns out to be another type", async () => {
    mockUpload.mockResolvedValueOnce(stored("video/mp4"));
    await expect(
      storeWidgetAttachment({
        organizationId: ORG,
        buffer: Buffer.from("abc"),
        mimeType: "image/jpeg",
        filename: "photo.jpg",
      }),
    ).rejects.toBeInstanceOf(WidgetAttachmentRejectedError);
    expect(mockDelete).toHaveBeenCalledWith("u1");
  });

  it("reports storage refusals (mislabelled content) as the shopper's error", async () => {
    mockUpload.mockRejectedValueOnce(new Error("File content is not a supported type"));
    await expect(
      storeWidgetAttachment({
        organizationId: ORG,
        buffer: Buffer.from("abc"),
        mimeType: "application/pdf",
        filename: "x.pdf",
      }),
    ).rejects.toBeInstanceOf(WidgetAttachmentRejectedError);
  });
});

describe("toPublicAttachments", () => {
  it("signs private files and never sends an unsigned media link", async () => {
    const result = await toPublicAttachments(
      [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "photo.jpg",
          url: "https://api.test/v1/media/11111111-1111-4111-8111-111111111111",
          type: "image/jpeg",
          size: 3,
          analysis: { internal: true },
        },
        // Another organization's upload: not signed by signAttachmentUrls, so dropped.
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "x.jpg",
          url: "https://api.test/v1/media/33333333-3333-4333-8333-333333333333",
          type: "image/jpeg",
          size: 3,
        },
        {
          id: "ext",
          name: "label.pdf",
          url: "https://cdn.example.com/label.pdf",
          type: "application/pdf",
          size: 9,
        },
        { id: "bad", name: "js", url: "javascript:alert(1)", type: "image/png", size: 1 },
      ],
      ORG,
    );
    expect(result).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "photo.jpg",
        url: "https://api.test/v1/media/11111111-1111-4111-8111-111111111111?expires=1&sig=abc",
        type: "image/jpeg",
        size: 3,
      },
      {
        id: "ext",
        name: "label.pdf",
        url: "https://cdn.example.com/label.pdf",
        type: "application/pdf",
        size: 9,
      },
    ]);
  });

  it("returns nothing for a message without files", async () => {
    expect(await toPublicAttachments(null, ORG)).toEqual([]);
    expect(await toPublicAttachments([], ORG)).toEqual([]);
  });
});

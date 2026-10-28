/**
 * D2-2: the conversation PDF shows the store and a full date, time and UTC
 * offset (in the organization's time zone) on every message.
 */
import { describe, it, expect } from "@jest/globals";
import { pdfText } from "../helpers/pdf-text";
import { ConversationExportService } from "../../services/conversation-export.service";
import { formatZonedDateTime } from "../../utils/zoned-datetime";
import type { Conversation } from "../../database/entities/conversation.entity";
import { MessageType, type Message } from "../../database/entities/message.entity";

describe("formatZonedDateTime", () => {
  it("shows date, time and offset in the given zone", () => {
    const at = new Date("2026-10-12T13:03:05Z");
    expect(formatZonedDateTime(at, "Europe/Lisbon")).toBe("2026-10-12 14:03:05 UTC+01:00");
    expect(formatZonedDateTime(at, "America/Sao_Paulo")).toBe("2026-10-12 10:03:05 UTC-03:00");
    expect(formatZonedDateTime(at, "UTC")).toBe("2026-10-12 13:03:05 UTC+00:00");
  });

  it("falls back to UTC for an unknown zone and is empty for no date", () => {
    expect(formatZonedDateTime("2026-01-01T00:00:00Z", "Not/AZone")).toBe(
      "2026-01-01 00:00:00 UTC+00:00",
    );
    expect(formatZonedDateTime(null, "UTC")).toBe("");
  });
});

describe("ConversationExportService.generatePdf (D2-2)", () => {
  it("puts the store name in the header and a full date on every message", async () => {
    const conversation = {
      id: "c1",
      title: "Where is my order",
      channel: "web",
      status: "closed",
      language: null,
      created_at: new Date("2026-10-10T09:00:00Z"),
      ended_at: null,
      closed_at: null,
      agent: null,
      customer: null,
      messages: [
        {
          type: MessageType.CUSTOMER,
          sender: null,
          content: "Hi, where is my parcel?",
          created_at: new Date("2026-10-10T09:00:00Z"),
          metadata: null,
          attachments: [],
        },
        {
          type: MessageType.BOT_AGENT,
          sender: null,
          content: "It was delivered.",
          created_at: new Date("2026-10-12T13:03:05Z"),
          metadata: null,
          attachments: [],
        },
      ] as unknown as Message[],
    } as unknown as Conversation;

    const pdf = await new ConversationExportService().generatePdf(conversation, {
      storeName: "Acme Shoes",
      timeZone: "Europe/Lisbon",
    });
    const text = pdfText(pdf);

    expect(text).toContain("Store: Acme Shoes");
    expect(text).toContain("Times shown in: Europe/Lisbon");
    expect(text).toContain("2026-10-10 10:00:00 UTC+01:00");
    expect(text).toContain("2026-10-12 14:03:05 UTC+01:00");
  });
});

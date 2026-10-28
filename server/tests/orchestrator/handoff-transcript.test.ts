import { describe, it, expect, jest } from "@jest/globals";

/** D8-10: the hand-off summary is written from a transcript that lists the customer's files. */

jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { handoffTranscriptLine } from "../../orchestrator/conversation-utils";
import { MessageType } from "@server/database/entities/message.entity";

describe("handoffTranscriptLine", () => {
  it("lists the files with their kind after the text", () => {
    expect(
      handoffTranscriptLine({
        type: MessageType.CUSTOMER,
        content: "It arrived broken",
        attachments: [
          { id: "1", name: "box.jpg", url: "u", type: "image/jpeg", size: 1 },
          { id: "2", name: "invoice.pdf", url: "u", type: "application/pdf", size: 1 },
        ],
      }),
    ).toBe("Customer: It arrived broken [Attachments: box.jpg (photo), invoice.pdf (PDF)]");
  });

  it("is the plain line without files", () => {
    expect(
      handoffTranscriptLine({ type: MessageType.BOT_AGENT, content: "Sorry!", attachments: null }),
    ).toBe("Assistant: Sorry!");
  });
});

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const insert = jest.fn<(row: Record<string, unknown>) => Promise<void>>();
const findMessage = jest.fn<(id: string) => Promise<unknown>>();
const findConversation = jest.fn<(id: string) => Promise<unknown>>();

jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ insert }) },
}));
jest.mock("@server/repositories/message.repository", () => ({
  messageRepository: { findById: (id: string) => findMessage(id) },
}));
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: { findById: (id: string) => findConversation(id) },
}));

import { MessageType } from "@server/database/entities/message.entity";
import { recordProductClick } from "@server/services/shopping-events.service";

const click = {
  conversationId: "conv-1",
  messageId: "msg-1",
  productId: "prod-1",
  type: "buy_click" as const,
};

const cards = {
  id: "msg-1",
  conversation_id: "conv-1",
  type: MessageType.PRODUCT_RECOMMENDATION,
  metadata: { productRecommendation: { products: [{ id: "prod-1" }, { id: "prod-2" }] } },
};

describe("recordProductClick", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findMessage.mockResolvedValue(cards);
    findConversation.mockResolvedValue({ id: "conv-1", organization_id: "org-1" });
    insert.mockResolvedValue(undefined);
  });

  it("records a click on a product the message showed", async () => {
    expect(await recordProductClick(click)).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      organizationId: "org-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      productId: "prod-1",
      type: "buy_click",
    });
  });

  it("ignores a product the message did not show", async () => {
    expect(await recordProductClick({ ...click, productId: "prod-9" })).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("ignores a message of another conversation", async () => {
    expect(await recordProductClick({ ...click, conversationId: "conv-2" })).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("ignores a message that is not product cards", async () => {
    findMessage.mockResolvedValue({ ...cards, type: MessageType.BOT_AGENT });
    expect(await recordProductClick(click)).toBe(false);
  });

  it("does not throw when the event cannot be stored", async () => {
    insert.mockRejectedValue(new Error('relation "shopping_events" does not exist'));
    expect(await recordProductClick(click)).toBe(false);
  });
});

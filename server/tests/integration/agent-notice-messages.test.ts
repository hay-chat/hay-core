import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { ConversationRepository } from "../../repositories/conversation.repository";
import { DeliveryState } from "../../types/message-feedback.types";

jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
  },
}));
jest.mock("../../services/push-notification.service", () => ({
  pushNotificationService: { onConversationStatusChanged: jest.fn() },
}));

/**
 * DB-backed: the widget reads join/leave lines through getWidgetMessages (a
 * jsonb filter), while the orchestrator reads history through
 * getPublicMessages and must never see them as conversation input.
 */
describe("agent join/leave notices in stored history", () => {
  const orgId = "a9e17000-0000-4000-8000-000000000001";
  const repository = new ConversationRepository();
  let conversationId: string;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(
        orgRepo.create({ id: orgId, name: "Agent Notice Org", slug: "agent-notice-org" }),
      );
    }
    const conversation = await repository.create({
      title: "notices",
      organization_id: orgId,
      status: "human-took-over",
    });
    conversationId = conversation.id;

    const messages = AppDataSource.getRepository(Message);
    const rows: Array<Partial<Message>> = [
      { type: MessageType.CUSTOMER, content: "I need a person" },
      {
        type: MessageType.SYSTEM,
        content: "Marina Souza took over this conversation",
        metadata: { systemEvent: "agent_joined", agentFirstName: "Marina" } as Message["metadata"],
      },
      {
        type: MessageType.SYSTEM,
        content: "Follow the refund playbook",
        metadata: null,
      },
      {
        type: MessageType.HUMAN_AGENT,
        content: "Hi, Marina here",
        metadata: { agentFirstName: "Marina" } as Message["metadata"],
      },
      {
        type: MessageType.SYSTEM,
        content: "Marina Souza returned this conversation to AI",
        metadata: { systemEvent: "agent_returned_to_ai" } as Message["metadata"],
      },
    ];
    let offset = 0;
    for (const row of rows) {
      const saved = await messages.save(
        messages.create({
          ...row,
          conversation_id: conversationId,
          deliveryState: DeliveryState.SENT,
        }),
      );
      // Distinct, ordered timestamps
      await messages.update(
        { id: saved.id },
        { created_at: new Date(Date.UTC(2026, 9, 27, 10, 0, offset++)) },
      );
    }
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("the widget gets the join/leave lines in order, but no other System message", async () => {
    const messages = await repository.getWidgetMessages(conversationId);
    expect(messages.map((m) => m.content)).toEqual([
      "I need a person",
      "Marina Souza took over this conversation",
      "Hi, Marina here",
      "Marina Souza returned this conversation to AI",
    ]);
  });

  it("the orchestrator's history never includes them", async () => {
    const messages = await repository.getPublicMessages(conversationId);
    expect(messages.map((m) => m.type)).toEqual([MessageType.CUSTOMER, MessageType.HUMAN_AGENT]);
  });

  it("a join/leave line does not count as answering the shopper (Return to AI still runs)", async () => {
    const conversation = await repository.create({
      title: "unanswered",
      organization_id: orgId,
      status: "human-took-over",
    });
    const messages = AppDataSource.getRepository(Message);
    const rows: Array<Partial<Message>> = [
      { type: MessageType.CUSTOMER, content: "Still there?" },
      {
        type: MessageType.SYSTEM,
        content: "Marina Souza took over this conversation",
        metadata: { systemEvent: "agent_joined" } as Message["metadata"],
      },
    ];
    let offset = 0;
    for (const row of rows) {
      const saved = await messages.save(
        messages.create({
          ...row,
          conversation_id: conversation.id,
          deliveryState: DeliveryState.SENT,
        }),
      );
      await messages.update(
        { id: saved.id },
        { created_at: new Date(Date.UTC(2026, 9, 27, 11, 0, offset++)) },
      );
    }

    expect(await repository.hasUnansweredCustomerMessage(conversation.id)).toBe(true);
  });
});

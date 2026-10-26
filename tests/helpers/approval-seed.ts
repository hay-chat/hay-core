import "reflect-metadata";
import { randomUUID } from "crypto";
import { AppDataSource } from "../../server/database/data-source";
import { User } from "../../server/entities/user.entity";
import { Agent } from "../../server/database/entities/agent.entity";
import { Customer } from "../../server/database/entities/customer.entity";
import { Conversation } from "../../server/database/entities/conversation.entity";
import { Message, MessageType, MessageStatus } from "../../server/database/entities/message.entity";
import { DeliveryState } from "../../server/types/message-feedback.types";
import { getTestUserEmail } from "./auth";

/**
 * Database seeding for the message-approval e2e spec.
 *
 * TypeORM entities need legacy decorators, which Playwright's own TypeScript
 * transform does not apply. Load this module through `tsx/cjs/api` (the same
 * way `global-setup.js` does), never with a plain `import` from a spec file.
 */

export interface QueuedReplySeed {
  userId: string;
  agentId: string;
  customerId: string;
  conversationId: string;
  messageId: string;
}

async function ensureConnection(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
}

/**
 * A WhatsApp conversation for the e2e organization whose agent requires
 * approval, with one customer question and one AI reply held in the queue.
 */
export async function seedQueuedReply(originalReply: string): Promise<QueuedReplySeed> {
  await ensureConnection();

  const user = await AppDataSource.getRepository(User).findOne({
    where: { email: getTestUserEmail() },
  });
  if (!user?.organizationId) {
    throw new Error("E2E user from global setup not found");
  }
  const organizationId = user.organizationId;

  const agent = await AppDataSource.getRepository(Agent).save({
    name: "E2E approval agent",
    organization_id: organizationId,
    testMode: true,
    channels: ["whatsapp"],
  });

  // (organization_id, external_id) is unique; parallel projects/workers seed concurrently.
  const customer = await AppDataSource.getRepository(Customer).save({
    organization_id: organizationId,
    external_id: `e2e-${randomUUID()}`,
    name: "E2E WhatsApp customer",
  });

  const conversation = await AppDataSource.getRepository(Conversation).save({
    title: "E2E approval conversation",
    channel: "whatsapp",
    status: "open",
    organization_id: organizationId,
    agent_id: agent.id,
    customer_id: customer.id,
  });

  const messages = AppDataSource.getRepository(Message);
  await messages.save({
    conversation_id: conversation.id,
    content: "When does my order ship?",
    type: MessageType.CUSTOMER,
    sender: "customer",
  });
  const queued = await messages.save({
    conversation_id: conversation.id,
    content: originalReply,
    type: MessageType.BOT_AGENT,
    sender: "assistant",
    status: MessageStatus.PENDING,
    reviewRequired: true,
    deliveryState: DeliveryState.QUEUED,
  });

  return {
    userId: user.id,
    agentId: agent.id,
    customerId: customer.id,
    conversationId: conversation.id,
    messageId: queued.id,
  };
}

export async function readMessage(messageId: string): Promise<Message> {
  await ensureConnection();
  return AppDataSource.getRepository(Message).findOneByOrFail({ id: messageId });
}

export async function cleanupQueuedReply(seed: QueuedReplySeed): Promise<void> {
  await ensureConnection();
  await AppDataSource.getRepository(Conversation).delete(seed.conversationId);
  await AppDataSource.getRepository(Customer).delete(seed.customerId);
  await AppDataSource.getRepository(Agent).delete(seed.agentId);
  // Release the pool so the worker can exit promptly.
  await AppDataSource.destroy();
}

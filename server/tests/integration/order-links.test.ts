/**
 * D2-4: the order index. Tool calls and message text write org-scoped links;
 * the backfill indexes stored messages; lookups never cross organizations.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));

import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { OrderConversationLink } from "../../database/entities/order-conversation-link.entity";
import { orderLinkService } from "../../services/order-links/order-link.service";

const orgId = "a1090000-0000-4000-8000-0000000000d2";
const otherOrgId = "a1090000-0000-4000-8000-0000000000d3";
const ids: Record<string, string> = {};

async function conversation(organizationId: string): Promise<string> {
  const repo = AppDataSource.getRepository(Conversation);
  return (
    await repo.save(
      repo.create({ organization_id: organizationId, title: "t", status: "open", metadata: {} }),
    )
  ).id;
}

describe("orderLinkService (D2-4)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "order-links-org"],
      [otherOrgId, "order-links-other"],
    ]) {
      if (!(await orgs.findOne({ where: { id } })))
        await orgs.save(orgs.create({ id, name: slug, slug }));
    }
    const conversations = AppDataSource.getRepository(Conversation);
    await conversations.delete({ organization_id: orgId });
    await conversations.delete({ organization_id: otherOrgId });
    ids.a = await conversation(orgId);
    ids.b = await conversation(orgId);
    ids.other = await conversation(otherOrgId);
  });

  afterAll(async () => {
    const conversations = AppDataSource.getRepository(Conversation);
    await conversations.delete({ organization_id: orgId });
    await conversations.delete({ organization_id: otherOrgId });
    await AppDataSource.destroy();
  });

  it("links a tool call and a text mention of the same order across conversations", async () => {
    await orderLinkService.recordFromToolCall({
      organizationId: orgId,
      conversationId: ids.a,
      messageId: null,
      pluginId: "core/shop",
      toolName: "shop_get_order",
      input: { order_id: "5566" },
      output: {
        content: [
          { type: "text", text: JSON.stringify({ id: "gid://s/Order/5566", name: "#1001" }) },
        ],
      },
    });
    // Recording twice adds nothing (unique index).
    await orderLinkService.recordFromToolCall({
      organizationId: orgId,
      conversationId: ids.a,
      messageId: null,
      pluginId: "core/shop",
      toolName: "shop_get_order",
      input: { order_id: "5566" },
    });
    // A new customer message in another conversation is indexed by the subscriber.
    const messages = AppDataSource.getRepository(Message);
    await messages.save(
      messages.create({
        conversation_id: ids.b,
        type: MessageType.CUSTOMER,
        content: "Pedido #1001 chegou partido",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Another org mentioning the same number stays out.
    await orderLinkService.recordFromMessage({
      id: "00000000-0000-4000-8000-000000000001",
      conversation_id: ids.other,
      type: MessageType.CUSTOMER,
      content: "order #1001",
    });

    const links = await AppDataSource.getRepository(OrderConversationLink).find({
      where: { organization_id: orgId },
    });
    expect(links).toHaveLength(3);

    const groups = await orderLinkService.findOrders(orgId, { query: "#1001" });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      pluginId: "core/shop",
      orderKey: "5566",
      orderLabel: "1001",
    });
    expect(groups[0].conversationIds.sort()).toEqual([ids.a, ids.b].sort());

    const byConversation = await orderLinkService.findOrders(orgId, { conversationId: ids.b });
    expect(byConversation[0].conversationIds.sort()).toEqual([ids.a, ids.b].sort());
    expect(await orderLinkService.findOrders(orgId, { query: "nothing" })).toEqual([]);
    const other = await orderLinkService.findOrders(otherOrgId, { query: "1001" });
    expect(other).toHaveLength(1);
    expect(other[0].conversationIds).toEqual([ids.other]);
  });

  it("backfills stored tool messages", async () => {
    const messages = AppDataSource.getRepository(Message);
    await messages.save(
      messages.create({
        conversation_id: ids.b,
        type: MessageType.TOOL,
        content: "Action completed",
        metadata: {
          toolName: "core/shop:shop_create_refund",
          toolInput: { order_id: "7788", amount: 5 },
          toolStatus: "SUCCESS",
        },
      }),
    );
    await orderLinkService.backfill({ organizationId: orgId, batchSize: 2 });
    const groups = await orderLinkService.findOrders(orgId, { query: "7788" });
    expect(groups).toHaveLength(1);
    expect(groups[0].conversationIds).toEqual([ids.b]);
  });
});

/**
 * D6-7: the action log query behind the dashboard Actions page.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));

import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { ActionLog } from "../../database/entities/action-log.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { actionLogService } from "../../services/action-log.service";

const orgId = "a1090000-0000-4000-8000-000000000007";
const otherOrgId = "a1090000-0000-4000-8000-000000000008";
let conversationId = "";
let otherConversationId = "";

function row(overrides: Partial<ActionLog>): Partial<ActionLog> {
  return {
    organization_id: orgId,
    conversation_id: conversationId,
    plugin_id: "shop",
    tool_name: "create_refund",
    category: "refund",
    read_only: false,
    args: {},
    outcome: "success",
    duration_ms: 5,
    ...overrides,
  };
}

describe("actionLogService.list (D6-7)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "action-log-org"],
      [otherOrgId, "action-log-other"],
    ]) {
      if (!(await orgs.findOne({ where: { id } }))) {
        await orgs.save(orgs.create({ id, name: slug, slug }));
      }
    }
    const conversations = AppDataSource.getRepository(Conversation);
    await conversations.delete({ organization_id: orgId });
    await conversations.delete({ organization_id: otherOrgId });
    conversationId = (
      await conversations.save(
        conversations.create({
          organization_id: orgId,
          title: "log",
          status: "open",
          metadata: {},
        }),
      )
    ).id;
    otherConversationId = (
      await conversations.save(
        conversations.create({
          organization_id: otherOrgId,
          title: "log",
          status: "open",
          metadata: {},
        }),
      )
    ).id;
    const logs = AppDataSource.getRepository(ActionLog);
    await logs.save([
      logs.create(row({ outcome: "success" })),
      logs.create(row({ outcome: "error", error_code: "PRECONDITION" })),
      logs.create(row({ tool_name: "get_order", read_only: true, category: null })),
      logs.create(row({ plugin_id: null, tool_name: "handoff" })),
      logs.create(row({ organization_id: otherOrgId, conversation_id: otherConversationId })),
    ]);
  });

  afterAll(async () => {
    const logs = AppDataSource.getRepository(ActionLog);
    await logs.delete({ organization_id: orgId });
    await logs.delete({ organization_id: otherOrgId });
    const conversations = AppDataSource.getRepository(Conversation);
    await conversations.delete({ organization_id: orgId });
    await conversations.delete({ organization_id: otherOrgId });
    await AppDataSource.destroy();
  });

  it("filters by tool, platform and outcome, only within the org", async () => {
    const page = { page: 1, pageSize: 25 };
    expect((await actionLogService.list(orgId, page)).total).toBe(4);
    expect((await actionLogService.list(orgId, { ...page, toolName: "create_refund" })).total).toBe(
      2,
    );
    expect((await actionLogService.list(orgId, { ...page, outcome: "error" })).items).toEqual([
      expect.objectContaining({ error_code: "PRECONDITION" }),
    ]);
    expect((await actionLogService.list(orgId, { ...page, pluginId: "core" })).items).toEqual([
      expect.objectContaining({ tool_name: "handoff" }),
    ]);
  });

  it("pages and lists the filter values", async () => {
    const first = await actionLogService.list(orgId, { page: 1, pageSize: 3 });
    const second = await actionLogService.list(orgId, { page: 2, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect(await actionLogService.filterOptions(orgId)).toEqual({
      tools: ["create_refund", "get_order", "handoff"],
      plugins: expect.arrayContaining(["shop", null]),
    });
  });
});

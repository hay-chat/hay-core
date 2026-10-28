import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Agent } from "../../database/entities/agent.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageStatus, MessageType } from "../../database/entities/message.entity";
import { DeliveryState } from "../../types/message-feedback.types";
import {
  readinessHint,
  softLaunchReadinessService,
} from "../../services/soft-launch-readiness.service";

/** D7-13: approve/edit/block counts per agent, and the "safe to turn off approval" hint. */
describe("soft-launch readiness", () => {
  const orgId = "d7130000-0000-4000-8000-000000000001";
  let agentId: string;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Readiness Org", slug: "d713-org" }));
    }
    const agent = await AppDataSource.getRepository(Agent).save({
      organization_id: orgId,
      name: "Store agent",
      testMode: true,
    });
    agentId = agent.id;

    const conversations = AppDataSource.getRepository(Conversation);
    const real = await conversations.save({
      organization_id: orgId,
      agent_id: agentId,
      title: "Real",
      channel: "web",
      status: "open",
      context: {},
      metadata: {},
    });
    const playground = await conversations.save({
      organization_id: orgId,
      agent_id: agentId,
      title: "Playground",
      channel: "web",
      status: "open",
      context: {},
      metadata: { isPlayground: true },
    });
    const reviewed = (status: MessageStatus, conversationId = real.id) => ({
      conversation_id: conversationId,
      content: "reply",
      type: MessageType.BOT_AGENT,
      status,
      approvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    await AppDataSource.getRepository(Message).insert([
      ...Array.from({ length: 3 }, () => reviewed(MessageStatus.APPROVED)),
      reviewed(MessageStatus.EDITED),
      reviewed(MessageStatus.REJECTED),
      reviewed(MessageStatus.APPROVED, playground.id),
      {
        conversation_id: real.id,
        content: "waiting",
        type: MessageType.BOT_AGENT,
        status: MessageStatus.PENDING,
        deliveryState: DeliveryState.QUEUED,
      },
    ]);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM agents WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("counts reviewed replies of real conversations per week and in the window", async () => {
    const [readiness] = await softLaunchReadinessService.forOrganization(orgId, { agentId });
    expect(readiness.requireApproval).toBe(true);
    expect(readiness.window).toMatchObject({
      reviewed: 5,
      approved: 3,
      edited: 1,
      blocked: 1,
      waiting: 1,
    });
    const totals = readiness.weeks.reduce((sum, w) => sum + w.approved + w.edited + w.blocked, 0);
    expect(totals).toBe(5);
    expect(readiness.hint).toBe("not_enough_reviews");
  });

  it("hints ready only with enough reviews and few changes", () => {
    expect(readinessHint(false, { reviewed: 500, edited: 0, blocked: 0 })).toBe("approval_off");
    expect(readinessHint(true, { reviewed: 49, edited: 0, blocked: 0 })).toBe("not_enough_reviews");
    expect(readinessHint(true, { reviewed: 100, edited: 3, blocked: 2 })).toBe("ready");
    expect(readinessHint(true, { reviewed: 100, edited: 4, blocked: 2 })).toBe("too_many_changes");
  });
});

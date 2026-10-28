/**
 * D2-3/D2-5: DisputeEvidenceService against the database: org-scoped load,
 * customer-visible messages only, store name and time zone on the PDF.
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
import { disputeEvidenceService } from "../../services/dispute-evidence/dispute-evidence.service";
import { pdfText } from "../helpers/pdf-text";

const orgId = "a1090000-0000-4000-8000-0000000000e2";
const otherOrgId = "a1090000-0000-4000-8000-0000000000e3";
let conversationId = "";
let otherConversationId = "";

describe("disputeEvidenceService.render", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, name] of [
      [orgId, "Evidence Store"],
      [otherOrgId, "Other Store"],
    ]) {
      await orgs.delete({ id });
      await orgs.save(
        orgs.create({
          id,
          name,
          slug: `evidence-${id.slice(-2)}`,
          timezone: "Europe/Lisbon",
        } as Partial<Organization>),
      );
    }
    const conversations = AppDataSource.getRepository(Conversation);
    const create = async (organization_id: string) =>
      (
        await conversations.save(
          conversations.create({
            organization_id,
            title: "t",
            status: "open",
            metadata: {},
            channel: "web",
          }),
        )
      ).id;
    conversationId = await create(orgId);
    otherConversationId = await create(otherOrgId);
    const messages = AppDataSource.getRepository(Message);
    await messages.save([
      messages.create({
        conversation_id: conversationId,
        type: MessageType.CUSTOMER,
        content: "Where is order #1001?",
        created_at: new Date("2026-07-01T09:00:00Z"),
      }),
      messages.create({
        conversation_id: conversationId,
        type: MessageType.SYSTEM,
        content: "SECRET SYSTEM PROMPT",
        created_at: new Date("2026-07-01T09:00:01Z"),
      }),
      messages.create({
        conversation_id: conversationId,
        type: MessageType.BOT_AGENT,
        content: "It shipped yesterday.",
        created_at: new Date("2026-07-01T09:00:05Z"),
      }),
      messages.create({
        conversation_id: otherConversationId,
        type: MessageType.CUSTOMER,
        content: "OTHER ORG MESSAGE",
      }),
    ]);
  });

  afterAll(async () => {
    const orgs = AppDataSource.getRepository(Organization);
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: otherOrgId });
    await orgs.delete({ id: orgId });
    await orgs.delete({ id: otherOrgId });
    await AppDataSource.destroy();
  });

  it("renders only this org's customer-visible messages in the store's time zone", async () => {
    const result = await disputeEvidenceService.render({
      organizationId: orgId,
      conversationIds: [conversationId, otherConversationId],
      template: "generic",
    });
    expect(result.conversationIds).toEqual([conversationId]);
    expect(result.storeName).toBe("Evidence Store");
    const text = pdfText(result.pdf);
    expect(text).toContain("Store: ");
    expect(text).toContain("Evidence Store");
    expect(text).toContain("2026-07-01 10:00:00 UTC+01:00 - Customer");
    expect(text).toContain("Where is order #1001?");
    expect(text).toContain("It shipped yesterday.");
    expect(text).not.toContain("SECRET SYSTEM PROMPT");
    expect(text).not.toContain("OTHER ORG MESSAGE");
  });
});

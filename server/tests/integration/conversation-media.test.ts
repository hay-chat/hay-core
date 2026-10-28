/**
 * D8-3: conversation media is linked to its message, deleted with its
 * conversations/customer, and swept after retention or when orphaned.
 */
import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false, publish: async () => undefined },
}));
jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: async () => undefined },
}));

import { AppDataSource } from "../../database/data-source";
import { config } from "../../config/env";
import { Organization } from "../../entities/organization.entity";
import { Upload } from "../../entities/upload.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import {
  deleteConversationMedia,
  linkUploadsToMessage,
  sweepConversationMedia,
} from "../../services/conversation-media.service";

const orgId = "d8030000-0000-4000-8000-000000000001";
const retentionOrgId = "d8030000-0000-4000-8000-000000000002";
const DAY = 24 * 60 * 60 * 1000;

async function makeUpload(
  organizationId: string,
  overrides: Partial<Upload> = {},
  ageMs = 0,
): Promise<Upload> {
  const filename = `${Math.random().toString(36).slice(2)}.png`;
  const relativePath = `${organizationId}/conversation-media/${filename}`;
  const fullPath = path.join(config.storage.local.uploadDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, "x");
  const upload = Upload.create({
    filename,
    originalName: "photo.png",
    path: relativePath,
    mimeType: "image/png",
    size: 1,
    storageType: "local",
    folder: "conversation-media",
    organizationId,
    ...overrides,
  } as Partial<Upload>) as Upload;
  await upload.save();
  if (ageMs) {
    await AppDataSource.query(`UPDATE uploads SET created_at = $2 WHERE id = $1`, [
      upload.id,
      new Date(Date.now() - ageMs),
    ]);
  }
  return upload;
}

function fileExists(upload: Upload): boolean {
  return fs.existsSync(path.join(config.storage.local.uploadDir, upload.path));
}

async function exists(upload: Upload): Promise<boolean> {
  return (await Upload.findOne({ where: { id: upload.id } })) !== null;
}

async function makeConversation(organizationId: string, legalHold = false): Promise<Conversation> {
  const conversations = AppDataSource.getRepository(Conversation);
  return conversations.save(
    conversations.create({
      organization_id: organizationId,
      title: "media",
      status: "open",
      metadata: {},
      legal_hold: legalHold,
    }),
  );
}

async function makeMessage(conversationId: string, attachmentIds: string[]): Promise<Message> {
  const messages = AppDataSource.getRepository(Message);
  return messages.save(
    messages.create({
      conversation_id: conversationId,
      content: "",
      type: MessageType.CUSTOMER,
      attachments: attachmentIds.map((id) => ({
        id,
        name: "photo.png",
        url: `https://api.example.test/v1/media/${id}`,
        type: "image/png",
        size: 1,
      })),
    }),
  );
}

async function cleanup() {
  for (const id of [orgId, retentionOrgId]) {
    await AppDataSource.query(`DELETE FROM uploads WHERE organization_id = $1`, [id]);
    await AppDataSource.getRepository(Conversation).delete({ organization_id: id });
  }
}

describe("conversation media lifecycle (D8-3)", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug, settings] of [
      [orgId, "media-org", {}],
      [retentionOrgId, "media-retention-org", { retentionDays: 30 }],
    ] as const) {
      if (!(await orgs.findOne({ where: { id } }))) {
        await orgs.save(orgs.create({ id, name: slug, slug, settings }));
      } else {
        await orgs.update({ id }, { settings });
      }
    }
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await AppDataSource.destroy();
  });

  it("addMessage links the message's uploads to it", async () => {
    const conversation = await makeConversation(orgId);
    const upload = await makeUpload(orgId);
    const message = await conversation.addMessage({
      content: "",
      type: MessageType.CUSTOMER,
      attachments: [
        { id: upload.id, name: "photo.png", url: "https://x.test", type: "image/png", size: 1 },
      ],
    });

    const linked = await Upload.findOneOrFail({ where: { id: upload.id } });
    expect(linked.messageId).toBe(message.id);
    expect(linked.conversationId).toBe(conversation.id);
  });

  it("never links another organization's upload or relinks a linked one", async () => {
    const conversation = await makeConversation(orgId);
    const foreign = await makeUpload(retentionOrgId);
    const firstMessage = await makeMessage(conversation.id, []);
    const secondMessage = await makeMessage(conversation.id, []);
    const own = await makeUpload(orgId);

    const link = (messageId: string) => ({
      conversationId: conversation.id,
      messageId,
      customerId: null,
    });
    await linkUploadsToMessage(orgId, [{ id: foreign.id }, { id: own.id }], link(firstMessage.id));
    await linkUploadsToMessage(orgId, [{ id: own.id }], link(secondMessage.id));

    expect((await Upload.findOneOrFail({ where: { id: foreign.id } })).messageId).toBeNull();
    expect((await Upload.findOneOrFail({ where: { id: own.id } })).messageId).toBe(firstMessage.id);
  });

  it("deletes files linked to the conversations or named by their messages", async () => {
    const target = await makeConversation(orgId);
    const other = await makeConversation(orgId);
    const linked = await makeUpload(orgId, { conversationId: target.id });
    const legacy = await makeUpload(orgId); // stored before linking existed
    await makeMessage(target.id, [legacy.id]);
    const kept = await makeUpload(orgId, { conversationId: other.id });

    const result = await deleteConversationMedia({
      organizationId: orgId,
      conversationIds: [target.id],
    });

    expect(result).toEqual({ deleted: 2, failed: 0 });
    expect(await exists(linked)).toBe(false);
    expect(fileExists(linked)).toBe(false);
    expect(await exists(legacy)).toBe(false);
    expect(await exists(kept)).toBe(true);
    expect(fileExists(kept)).toBe(true);
  });

  it("sweeps media past retention (180 days default), keeps legal holds, and sweeps orphans", async () => {
    const conversation = await makeConversation(orgId);
    const held = await makeConversation(orgId, true);
    const message = await makeMessage(conversation.id, []);
    const link = { conversationId: conversation.id, messageId: message.id };

    const expiredDefault = await makeUpload(orgId, link, 181 * DAY);
    const freshDefault = await makeUpload(orgId, link, 100 * DAY);
    const onHold = await makeUpload(orgId, { conversationId: held.id }, 400 * DAY);

    const retentionConversation = await makeConversation(retentionOrgId);
    const retentionMessage = await makeMessage(retentionConversation.id, []);
    const expiredByOrg = await makeUpload(
      retentionOrgId,
      { conversationId: retentionConversation.id, messageId: retentionMessage.id },
      31 * DAY,
    );

    const orphan = await makeUpload(orgId, {}, 2 * DAY);
    const recentOrphan = await makeUpload(orgId, {}, 60 * 60 * 1000);
    const namedByMessage = await makeUpload(orgId, {}, 2 * DAY);
    await AppDataSource.query(`UPDATE messages SET attachments = $2 WHERE id = $1`, [
      message.id,
      JSON.stringify([{ id: namedByMessage.id, name: "p", url: "u", type: "image/png", size: 1 }]),
    ]);

    await sweepConversationMedia();

    expect(await exists(expiredDefault)).toBe(false);
    expect(fileExists(expiredDefault)).toBe(false);
    expect(await exists(freshDefault)).toBe(true);
    expect(await exists(onHold)).toBe(true);
    expect(await exists(expiredByOrg)).toBe(false);
    expect(await exists(orphan)).toBe(false);
    expect(await exists(recentOrphan)).toBe(true);
    expect(await exists(namedByMessage)).toBe(true);
  });
});

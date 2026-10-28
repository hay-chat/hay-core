import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Playbook, PlaybookStatus } from "../../database/entities/playbook.entity";
import {
  PlaybookVersion,
  PlaybookVersionStatus,
} from "../../database/entities/playbook-version.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { withOverridePlaybook } from "../../services/playbook-version-override";

jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
    broadcastMessageReceived: jest.fn(),
  },
}));
jest.mock("../../services/conversation-alert.service", () => ({
  conversationAlertService: { onConversationStatusChanged: jest.fn() },
}));
jest.mock("../../services/mcp-registry.service", () => ({
  mcpRegistryService: { getToolsForOrg: jest.fn(async () => []) },
}));

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** D7-5: a test conversation runs a playbook draft; a real one never does. */
describe("test a playbook draft (playbookVersionOverride)", () => {
  const orgId = "d7500000-0000-4000-8000-000000000001";
  let livePlaybook: Playbook;
  let newPlaybook: Playbook;
  let liveVersion: PlaybookVersion;
  let draftVersion: PlaybookVersion;
  let newDraft: PlaybookVersion;

  async function conversationWith(metadata: Record<string, unknown>): Promise<Conversation> {
    const repo = AppDataSource.getRepository(Conversation);
    return repo.save(
      repo.create({ title: "draft test", organization_id: orgId, status: "open", metadata }),
    );
  }

  async function playbookMessage(conversationId: string): Promise<Message | null> {
    return AppDataSource.getRepository(Message).findOne({
      where: { conversation_id: conversationId, type: MessageType.PLAYBOOK },
    });
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Draft Test Org", slug: "d75-org" }));
    }

    const playbooks = AppDataSource.getRepository(Playbook);
    const versions = AppDataSource.getRepository(PlaybookVersion);

    livePlaybook = await playbooks.save(
      playbooks.create({
        title: "Refunds",
        trigger: "refund",
        organization_id: orgId,
        status: PlaybookStatus.ACTIVE,
        instructions: doc("LIVE refund steps"),
      }),
    );
    liveVersion = await versions.save(
      versions.create({
        playbook_id: livePlaybook.id,
        version_number: 1,
        status: PlaybookVersionStatus.ACTIVE,
        instructions: doc("LIVE refund steps"),
      }),
    );
    draftVersion = await versions.save(
      versions.create({
        playbook_id: livePlaybook.id,
        version_number: 2,
        status: PlaybookVersionStatus.DRAFT,
        instructions: doc("DRAFT refund steps"),
      }),
    );
    await playbooks.update(livePlaybook.id, {
      active_version_id: liveVersion.id,
      draft_version_id: draftVersion.id,
    });

    newPlaybook = await playbooks.save(
      playbooks.create({
        title: "Exchanges",
        trigger: "exchange",
        organization_id: orgId,
        status: PlaybookStatus.DRAFT,
      }),
    );
    newDraft = await versions.save(
      versions.create({
        playbook_id: newPlaybook.id,
        version_number: 1,
        status: PlaybookVersionStatus.DRAFT,
        instructions: doc("NEW exchange steps"),
      }),
    );
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM playbooks WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("a playground conversation runs the draft and records its version", async () => {
    const conversation = await conversationWith({
      sourceId: "playground",
      playbookVersionOverride: { playbookId: livePlaybook.id, versionId: draftVersion.id },
    });
    await conversation.updatePlaybook(livePlaybook.id);

    const saved = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(saved.playbook_version_id).toBe(draftVersion.id);
    const message = await playbookMessage(conversation.id);
    expect(message?.content).toContain("DRAFT refund steps");
    expect(message?.metadata).toMatchObject({ playbookVersionId: draftVersion.id, isDraft: true });
  });

  it("a real conversation ignores the override and runs the live version", async () => {
    const conversation = await conversationWith({
      playbookVersionOverride: { playbookId: livePlaybook.id, versionId: draftVersion.id },
    });
    await conversation.updatePlaybook(livePlaybook.id);

    const saved = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(saved.playbook_version_id).toBe(liveVersion.id);
    expect((await playbookMessage(conversation.id))?.content).toContain("LIVE refund steps");
  });

  it("a version of another playbook is not used", async () => {
    const conversation = await conversationWith({
      sourceId: "playground",
      playbookVersionOverride: { playbookId: livePlaybook.id, versionId: newDraft.id },
    });
    await conversation.updatePlaybook(livePlaybook.id);

    const saved = await AppDataSource.getRepository(Conversation).findOneByOrFail({
      id: conversation.id,
    });
    expect(saved.playbook_version_id).toBe(liveVersion.id);
  });

  it("offers a never-published playbook to the selector only while it is tested", async () => {
    const load = async (id: string) =>
      AppDataSource.getRepository(Playbook).findOneBy({ id, organization_id: orgId });
    const live = [livePlaybook];

    const tested = await withOverridePlaybook(
      {
        sourceId: "playground",
        playbookVersionOverride: { playbookId: newPlaybook.id, versionId: newDraft.id },
      },
      orgId,
      live,
      load,
    );
    expect(tested.map((p) => p.id)).toEqual([livePlaybook.id, newPlaybook.id]);

    const real = await withOverridePlaybook(
      { playbookVersionOverride: { playbookId: newPlaybook.id, versionId: newDraft.id } },
      orgId,
      live,
      load,
    );
    expect(real.map((p) => p.id)).toEqual([livePlaybook.id]);

    const otherOrg = await withOverridePlaybook(
      {
        sourceId: "playground",
        playbookVersionOverride: { playbookId: newPlaybook.id, versionId: newDraft.id },
      },
      "d7500000-0000-4000-8000-0000000000ff",
      live,
      async (id, organizationId) =>
        AppDataSource.getRepository(Playbook).findOneBy({ id, organization_id: organizationId }),
    );
    expect(otherOrg.map((p) => p.id)).toEqual([livePlaybook.id]);
  });
});

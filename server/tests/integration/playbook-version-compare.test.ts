import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Playbook, PlaybookStatus } from "../../database/entities/playbook.entity";
import {
  PlaybookVersion,
  PlaybookVersionStatus,
} from "../../database/entities/playbook-version.entity";
import { PlaybookService } from "../../services/playbook.service";

const doc = (...content: unknown[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (value: string) => ({ type: "text", text: value });
const mention = (id: string, label: string) => ({
  type: "mention",
  attrs: { id, type: "action", label, pluginId: "acme" },
});

/** D7-6: any version (default: the draft) as markdown next to the active one. */
describe("PlaybookService.compareWithActive", () => {
  const orgId = "d7600000-0000-4000-8000-000000000001";
  const service = new PlaybookService();
  let playbook: Playbook;
  let neverPublished: Playbook;
  let active: PlaybookVersion;
  let archived: PlaybookVersion;
  let draft: PlaybookVersion;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    if (!(await orgs.findOne({ where: { id: orgId } }))) {
      await orgs.save(orgs.create({ id: orgId, name: "Compare Org", slug: "d76-org" }));
    }
    const playbooks = AppDataSource.getRepository(Playbook);
    const versions = AppDataSource.getRepository(PlaybookVersion);
    playbook = await playbooks.save(
      playbooks.create({
        title: "Refunds",
        trigger: "refund",
        organization_id: orgId,
        status: PlaybookStatus.ACTIVE,
      }),
    );
    const version = (n: number, status: PlaybookVersionStatus, instructions: unknown) =>
      versions.save(
        versions.create({
          playbook_id: playbook.id,
          version_number: n,
          status,
          instructions: instructions as Playbook["instructions"],
        }),
      );
    archived = await version(1, PlaybookVersionStatus.ARCHIVED, doc(text("Old steps")));
    active = await version(2, PlaybookVersionStatus.ACTIVE, doc(text("Refund within 30 days")));
    draft = await version(
      3,
      PlaybookVersionStatus.DRAFT,
      doc(text("Refund within 14 days, then "), mention("acme:refund_order", "Refund order")),
    );
    neverPublished = await playbooks.save(
      playbooks.create({
        title: "Exchanges",
        trigger: "exchange",
        organization_id: orgId,
        status: PlaybookStatus.DRAFT,
      }),
    );
    await versions.save(
      versions.create({
        playbook_id: neverPublished.id,
        version_number: 1,
        status: PlaybookVersionStatus.DRAFT,
        instructions: doc(text("Exchange steps")) as Playbook["instructions"],
      }),
    );
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM playbooks WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("defaults to the draft vs the active version, with mention references", async () => {
    const result = await service.compareWithActive(orgId, playbook.id);
    expect(result.active).toEqual({ id: active.id, versionNumber: 2, status: "active" });
    expect(result.version.id).toBe(draft.id);
    expect(result.currentMarkdown).toContain("Refund within 30 days");
    expect(result.revisedMarkdown).toContain("Refund within 14 days");
    expect(result.revisedMarkdown).toContain("<<action:acme:refund_order>>");
    expect(result.references.actions).toEqual([
      { id: "acme:refund_order", name: "Refund order", pluginId: "acme", pluginName: "acme" },
    ]);
  });

  it("compares an archived version with the active one", async () => {
    const result = await service.compareWithActive(orgId, playbook.id, archived.id);
    expect(result.version.versionNumber).toBe(1);
    expect(result.revisedMarkdown).toContain("Old steps");
  });

  it("diffs a never-published playbook against nothing", async () => {
    const result = await service.compareWithActive(orgId, neverPublished.id);
    expect(result.active).toBeNull();
    expect(result.currentMarkdown).toBe("");
    expect(result.revisedMarkdown).toContain("Exchange steps");
  });

  it("refuses another playbook's version and another org", async () => {
    await expect(
      service.compareWithActive(orgId, neverPublished.id, draft.id),
    ).rejects.toThrow("Version not found");
    await expect(
      service.compareWithActive("d7600000-0000-4000-8000-0000000000ff", playbook.id),
    ).rejects.toThrow("Playbook not found");
  });
});

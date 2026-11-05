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

const doc = (value: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  }) as Playbook["instructions"];

describe("PlaybookService.duplicatePlaybook", () => {
  const orgId = "d7700000-0000-4000-8000-000000000001";
  const otherOrgId = "d7700000-0000-4000-8000-000000000002";
  const service = new PlaybookService();
  let source: Playbook;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "playbook-duplicate-org"],
      [otherOrgId, "playbook-duplicate-other"],
    ]) {
      if (!(await orgs.findOne({ where: { id } }))) {
        await orgs.save(orgs.create({ id, name: slug, slug }));
      }
    }
    const playbooks = AppDataSource.getRepository(Playbook);
    source = await playbooks.save(
      playbooks.create({
        title: "Refunds",
        trigger: "refund",
        description: "Refund flow",
        instructions: doc("Published steps"),
        organization_id: orgId,
        status: PlaybookStatus.ACTIVE,
        approval_categories: ["refund"],
      }),
    );
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Playbook).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete([orgId, otherOrgId]);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("copies a live playbook as a draft and keeps its approval override", async () => {
    const copy = await service.duplicatePlaybook(orgId, source.id, "Refunds (copy)");

    expect(copy).toMatchObject({
      title: "Refunds (copy)",
      trigger: "refund",
      description: "Refund flow",
      status: PlaybookStatus.DRAFT,
      approval_categories: ["refund"],
    });
    expect(copy!.id).not.toBe(source.id);
    expect(copy!.instructions).toEqual(doc("Published steps"));

    const draft = await service.getDraft(orgId, copy!.id);
    expect(draft?.instructions).toEqual(doc("Published steps"));
  });

  it("copies unpublished edits when the source has a draft", async () => {
    const versions = AppDataSource.getRepository(PlaybookVersion);
    await versions.save(
      versions.create({
        playbook_id: source.id,
        version_number: 2,
        status: PlaybookVersionStatus.DRAFT,
        instructions: doc("Unpublished steps"),
      }),
    );

    const copy = await service.duplicatePlaybook(orgId, source.id, "Refunds (copy 2)");

    expect(copy!.instructions).toEqual(doc("Unpublished steps"));
    expect((await service.getPlaybook(orgId, source.id))!.instructions).toEqual(
      doc("Published steps"),
    );
  });

  it("does not copy a playbook from another organization", async () => {
    await expect(service.duplicatePlaybook(otherOrgId, source.id, "Stolen")).resolves.toBeNull();
  });
});

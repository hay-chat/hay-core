import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { TestTranscript } from "../../database/entities/test-transcript.entity";
import { testTranscriptService } from "../../services/test-transcript.service";
import { parseGenericCsv } from "../../services/importers/transcripts/csv";
import {
  TranscriptImportError,
  type TestTranscript as ParsedTranscript,
} from "../../services/importers/transcripts/test-transcript";
import { JobStatus } from "../../entities/job.entity";

async function* tickets(count: number, failAfter?: number): AsyncGenerator<ParsedTranscript> {
  for (let i = 1; i <= count; i++) {
    if (failAfter !== undefined && i > failAfter) {
      throw new TranscriptImportError("Gorgias refused the email and API key");
    }
    await Promise.resolve();
    yield { externalId: String(i), turns: [{ role: "customer", text: `Question ${i}` }] };
  }
}

async function settled(orgId: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = await testTranscriptService.importStatus(orgId, jobId);
    if (status && status.status !== JobStatus.PROCESSING) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("import never settled");
}

/** D7-8: imported transcripts are stored per organization and follow retention. */
describe("test transcripts", () => {
  const orgId = "d7800000-0000-4000-8000-000000000001";
  const otherOrgId = "d7800000-0000-4000-8000-000000000002";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgs = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "d78-org"],
      [otherOrgId, "d78-other"],
    ]) {
      await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [id]);
      await orgs.save(orgs.create({ id, name: slug, slug }));
    }
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [
      orgId,
      otherOrgId,
    ]);
    await AppDataSource.destroy();
  });

  it("stores an import as one batch, scoped to the organization", async () => {
    const csv = [
      "conversation_id,role,text,timestamp,order_ref",
      "c1,customer,Where is my order?,2026-10-01T10:00:00Z,#1001",
      "c1,agent,On its way,2026-10-01T10:01:00Z,",
      "c2,customer,Do you ship to Lisbon?,,",
    ].join("\n");
    const result = await testTranscriptService.importTranscripts({
      organizationId: orgId,
      source: "csv",
      transcripts: parseGenericCsv(csv),
    });
    expect(result.imported).toBe(2);

    const { items, total } = await testTranscriptService.list(orgId, {
      limit: 50,
      offset: 0,
      importBatchId: result.importBatchId,
    });
    expect(total).toBe(2);
    const c1 = items.find((i) => i.externalId === "c1")!;
    expect(c1).toMatchObject({
      source: "csv",
      orderRef: "#1001",
      turnCount: 2,
      preview: "Where is my order?",
    });
    expect(c1.startedAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");

    expect(await testTranscriptService.get(otherOrgId, c1.id)).toBeNull();
    expect(await testTranscriptService.remove(otherOrgId, [c1.id])).toBe(0);
    expect((await testTranscriptService.get(orgId, c1.id))?.turns).toHaveLength(2);
    expect(await testTranscriptService.remove(orgId, [c1.id])).toBe(1);
  });

  it("deletes transcripts older than the organization's retention, and only those", async () => {
    const repo = AppDataSource.getRepository(TestTranscript);
    await AppDataSource.query(`DELETE FROM test_transcripts WHERE organization_id IN ($1, $2)`, [
      orgId,
      otherOrgId,
    ]);
    await AppDataSource.getRepository(Organization).update(orgId, {
      settings: { retentionDays: 30 },
    });
    await AppDataSource.getRepository(Organization).update(otherOrgId, { settings: {} });

    const make = (organizationId: string, daysAgo: number) =>
      repo.save(
        repo.create({
          organization_id: organizationId,
          source: "paste",
          turns: [{ role: "customer", text: "hi" }],
          turn_count: 1,
          import_batch_id: "d7800000-0000-4000-8000-0000000000aa",
          created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        }),
      );
    const old = await make(orgId, 40);
    const recent = await make(orgId, 5);
    const keptForever = await make(otherOrgId, 400);

    expect(await testTranscriptService.deleteExpired()).toBeGreaterThanOrEqual(1);
    expect(await repo.findOneBy({ id: old.id })).toBeNull();
    expect(await repo.findOneBy({ id: recent.id })).not.toBeNull();
    expect(await repo.findOneBy({ id: keptForever.id })).not.toBeNull();
  });

  it("F10: imports a slow source in the background, in batches, past the old 100 cap", async () => {
    const started = await testTranscriptService.importInBackground({
      organizationId: orgId,
      source: "gorgias",
      transcripts: tickets(130),
    });
    expect(await testTranscriptService.importStatus(otherOrgId, started.jobId)).toBeNull();

    const status = await settled(orgId, started.jobId);
    expect(status).toMatchObject({
      status: JobStatus.COMPLETED,
      importBatchId: started.importBatchId,
      imported: 130,
      error: null,
    });
    const { total } = await testTranscriptService.list(orgId, {
      limit: 1,
      offset: 0,
      importBatchId: started.importBatchId,
    });
    expect(total).toBe(130);
  });

  it("F10: a failing source ends the job FAILED with the reason, keeping what landed", async () => {
    const started = await testTranscriptService.importInBackground({
      organizationId: orgId,
      source: "gorgias",
      transcripts: tickets(130, 60),
    });
    const status = await settled(orgId, started.jobId);
    expect(status).toMatchObject({
      status: JobStatus.FAILED,
      imported: 50,
      error: "Gorgias refused the email and API key",
    });

    const empty = await testTranscriptService.importInBackground({
      organizationId: orgId,
      source: "gorgias",
      transcripts: tickets(0),
    });
    expect(await settled(orgId, empty.jobId)).toMatchObject({
      status: JobStatus.FAILED,
      error: "No conversations found",
    });
  });
});

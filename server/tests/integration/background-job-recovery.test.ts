/**
 * Work left behind by a server that stopped mid-run must become runnable again,
 * while work a live server holds stays claimed.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { v4 as uuidv4 } from "uuid";
import { AppDataSource } from "@server/database/data-source";
import { documentSourceRepository } from "@server/repositories/document-source.repository";
import { jobQueueService } from "@server/services/job-queue.service";
import { staleMessageDetectorService } from "@server/services/stale-message-detector.service";

const ORG_ID = uuidv4();

const insertSource = async (status: string | null, startedMinutesAgo: number | null) => {
  const id = uuidv4();
  await AppDataSource.query(
    `INSERT INTO document_sources
       (id, organization_id, plugin_id, source_type, display_name, external_root_id, enabled,
        config, last_sync_status, last_sync_started_at, last_synced_at)
     VALUES ($1::uuid, $2, 'p', 'fake', 'Fake', $1::text, true, '{}', $3,
             CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(mins => $4::int) END,
             now())`,
    [id, ORG_ID, status, startedMinutesAgo],
  );
  return id;
};

const insertJob = async (type: string, minutesAgo: number, attempts = 0) => {
  const id = uuidv4();
  await AppDataSource.query(
    `INSERT INTO jobs (id, organization_id, title, status, data, updated_at)
     VALUES ($1, $2, 'job', 'processing', $3::jsonb, now() - make_interval(mins => $4::int))`,
    [id, ORG_ID, JSON.stringify({ type, attempts }), minutesAgo],
  );
  return id;
};

const jobOf = async (id: string) => {
  const [row] = await AppDataSource.query(`SELECT status, data FROM jobs WHERE id = $1`, [id]);
  return row as { status: string; data: { attempts: number } };
};

describe("background job recovery", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)`, [
      ORG_ID,
      "Recovery test",
      `recovery-${ORG_ID}`,
    ]);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [ORG_ID]);
    await AppDataSource.destroy();
  });

  it("lets a stale sync be claimed once and keeps a live one blocked", async () => {
    const fresh = await insertSource("running", 2);
    const stale = await insertSource("running", 16);
    const crashedBeforeColumnExisted = await insertSource("running", null);

    const due = (await documentSourceRepository.findDueForSync()).map((source) => source.id);
    expect(due).not.toContain(fresh);
    expect(due).toEqual(expect.arrayContaining([stale, crashedBeforeColumnExisted]));

    expect(await documentSourceRepository.markRunning(fresh)).toBe(false);
    expect(await documentSourceRepository.markRunning(stale)).toBe(true);
    expect(await documentSourceRepository.markRunning(stale)).toBe(false);
  });

  it("requeues stale background jobs by type, and fails one that keeps dying", async () => {
    const staleSync = await insertJob("document_source_sync", 16);
    const liveSync = await insertJob("document_source_sync", 5);
    const liveExport = await insertJob("organization_export", 60);
    const staleExport = await insertJob("organization_export", 121);
    const dying = await insertJob("document_source_sync", 16, 2);
    const inline = await insertJob("web_import", 600);
    const privacy = await insertJob("privacy_export", 600);

    await jobQueueService.requeueStaleJobs();

    expect(await jobOf(staleSync)).toMatchObject({ status: "queued", data: { attempts: 1 } });
    expect(await jobOf(staleExport)).toMatchObject({ status: "queued" });
    expect(await jobOf(dying)).toMatchObject({ status: "failed", data: { attempts: 3 } });
    for (const untouched of [liveSync, liveExport, inline, privacy]) {
      expect((await jobOf(untouched)).status).toBe("processing");
    }
  });

  it("does not requeue a long job whose server is still working on it", async () => {
    const running = await insertJob("document_source_sync", 20);

    await jobQueueService.touchRunningJob(running);
    await jobQueueService.requeueStaleJobs();

    expect((await jobOf(running)).status).toBe("processing");
  });

  it("leaves a conversation alone until its cooldown ends", async () => {
    const customerId = uuidv4();
    await AppDataSource.query(
      `INSERT INTO customers (id, organization_id, external_id) VALUES ($1, $2, 'c1')`,
      [customerId, ORG_ID],
    );
    const insertFailing = async (cooldownMinutes: number) => {
      const id = uuidv4();
      await AppDataSource.query(
        `INSERT INTO conversations
           (id, organization_id, customer_id, channel, title, status, processing_error_count, cooldown_until)
         VALUES ($1, $2, $3, 'web', 't', 'open', 3, now() + make_interval(mins => $4::int))`,
        [id, ORG_ID, customerId, cooldownMinutes],
      );
      await AppDataSource.query(
        `INSERT INTO messages (id, conversation_id, content, type, created_at)
         VALUES ($1, $2, 'hello', 'Customer', now() - interval '1 hour')`,
        [uuidv4(), id],
      );
      return id;
    };
    const cooling = await insertFailing(10);
    const elapsed = await insertFailing(-10);

    const found = (await staleMessageDetectorService.detectStaleConversations()).map(
      (conversation) => conversation.conversationId,
    );

    expect(found).toContain(elapsed);
    expect(found).not.toContain(cooling);
  });
});

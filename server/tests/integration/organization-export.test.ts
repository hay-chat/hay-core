import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Job, JobStatus } from "../../entities/job.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { Message, MessageType } from "../../database/entities/message.entity";
import { Customer } from "../../database/entities/customer.entity";

const uploads: Array<{ buffer: Buffer; folder: string; organizationId: string }> = [];
const deleted: string[] = [];
const audits: Array<{ action: string; organizationId: string }> = [];

jest.mock("../../services/storage.service", () => ({
  storageService: {
    upload: jest.fn(async (input: { buffer: Buffer; folder: string; organizationId: string }) => {
      uploads.push(input);
      return { upload: { id: `00000000-0000-4000-8000-00000000000${uploads.length}` } };
    }),
    delete: jest.fn(async (id: string) => {
      deleted.push(id);
    }),
  },
}));
jest.mock("../../services/audit-log.service", () => ({
  auditLogService: {
    log: jest.fn(async (entry: { action: string; organizationId: string }) => {
      audits.push(entry);
    }),
  },
}));
jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: {
    broadcastConversationCreated: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
  },
}));

import {
  csvCell,
  csvLine,
  organizationExportService,
} from "../../services/organization-export.service";

describe("csv helpers", () => {
  it("quotes, serialises objects and defuses formulas", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvLine({ a: 1, b: "x" }, ["b", "a", "missing"])).toBe("x,1,\r\n");
  });
});

/**
 * DB-backed: the export is raw SQL over many tables, so the only useful test
 * runs it against the real schema (hay_test).
 */
describe("organization export", () => {
  const orgId = "e0e0e0e0-0000-4000-8000-000000000001";
  const otherOrgId = "e0e0e0e0-0000-4000-8000-000000000002";
  const userId = "e0e0e0e0-0000-4000-8000-0000000000aa";
  const now = new Date("2026-10-20T12:00:00Z");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "org-export-test-"));

  async function cleanup() {
    for (const id of [orgId, otherOrgId]) {
      await AppDataSource.query(
        `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = $1)`,
        [id],
      );
      await AppDataSource.getRepository(Conversation).delete({ organization_id: id });
      await AppDataSource.getRepository(Customer).delete({ organization_id: id });
      await AppDataSource.getRepository(Job).delete({ organizationId: id });
      await AppDataSource.getRepository(Organization).delete({ id });
    }
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await cleanup();
    const orgs = AppDataSource.getRepository(Organization);
    await orgs.save(orgs.create({ id: orgId, name: "Export Org", slug: "export-org-test" }));
    await orgs.save(orgs.create({ id: otherOrgId, name: "Other Org", slug: "export-other-test" }));

    for (const [org, name] of [
      [orgId, "Ana"],
      [otherOrgId, "Not mine"],
    ]) {
      const customer = await AppDataSource.getRepository(Customer).save(
        AppDataSource.getRepository(Customer).create({
          organization_id: org,
          name,
          email: `${name.replace(" ", "")}@example.com`,
        }),
      );
      const conversation = await AppDataSource.getRepository(Conversation).save(
        AppDataSource.getRepository(Conversation).create({
          title: `Order question ${name}`,
          organization_id: org,
          customer_id: customer.id,
          status: "open",
          channel: "web",
          metadata: {},
        }),
      );
      await AppDataSource.getRepository(Message).save(
        AppDataSource.getRepository(Message).create({
          conversation_id: conversation.id,
          content: `Where is my order, says ${name}, "quoted"`,
          type: MessageType.CUSTOMER,
        }),
      );
    }
  });

  afterAll(async () => {
    await cleanup();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("queues one job, builds the ZIP for this organization only, and hands out a signed link", async () => {
    expect(await organizationExportService.getState(orgId)).toBeNull();
    expect(await organizationExportService.downloadLink(orgId, userId, now)).toBeNull();

    const first = await organizationExportService.request(orgId, userId, now);
    const again = await organizationExportService.request(orgId, userId, now);
    expect(again).toEqual({ jobId: first.jobId, alreadyRunning: true });
    expect((await organizationExportService.getState(orgId, now))?.status).toBe("queued");

    const job = await AppDataSource.getRepository(Job).findOneByOrFail({ id: first.jobId });
    const result = await organizationExportService.processJob(job, now);
    expect(result.counts).toMatchObject({ conversations: 1, messages: 1, customers: 1 });
    expect(result.fileName).toBe("hay-chat-export-2026-10-20.zip");

    const zip = path.join(tmp, "export.zip");
    fs.writeFileSync(zip, uploads[0].buffer);
    expect(uploads[0].folder).toBe("organization-exports");
    const listing = execFileSync("unzip", ["-Z1", zip]).toString().split("\n").filter(Boolean);
    expect(listing).toEqual(
      expect.arrayContaining([
        "README.txt",
        "organization.json",
        "conversations.jsonl",
        "conversations.csv",
        "messages.jsonl",
        "messages.csv",
        "customers.jsonl",
        "customers.csv",
        "documents.jsonl",
        "playbooks.jsonl",
        "playbook_versions.jsonl",
        "agents.jsonl",
        "webchat_settings.jsonl",
        "business_hours.jsonl",
      ]),
    );
    const messages = execFileSync("unzip", ["-p", zip, "messages.jsonl"]).toString();
    expect(messages).toContain("says Ana");
    expect(messages).not.toContain("Not mine");
    const customersCsv = execFileSync("unzip", ["-p", zip, "customers.csv"]).toString();
    expect(customersCsv.split("\r\n")[0]).toBe("id,name,email,phone,external_id,notes,created_at");
    expect(customersCsv).toContain("Ana");
    const org = JSON.parse(execFileSync("unzip", ["-p", zip, "organization.json"]).toString());
    expect(org.name).toBe("Export Org");

    await AppDataSource.getRepository(Job).update(job.id, {
      status: JobStatus.COMPLETED,
      result,
    });
    const state = await organizationExportService.getState(orgId, now);
    expect(state?.status).toBe("completed");

    const link = await organizationExportService.downloadLink(orgId, userId, now);
    expect(link?.url).toContain(`/v1/media/${result.uploadId}`);
    expect(audits.map((a) => a.action)).toEqual([
      "organization.export.request",
      "organization.export.download",
    ]);

    // Past retention: the link is gone and the daily cleanup removes the file.
    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await organizationExportService.downloadLink(orgId, userId, later)).toBeNull();
    expect((await organizationExportService.getState(orgId, later))?.status).toBe("expired");
    expect(await organizationExportService.cleanupExpired(later)).toBeGreaterThanOrEqual(1);
    expect(deleted).toContain(result.uploadId);
  });
});

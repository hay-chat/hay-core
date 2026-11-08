/**
 * Privacy requests end to end: queued jobs, export download links, staff-user
 * and customer erasure. Erasure is checked by scanning every text/jsonb column
 * of the database for the subject's email, name or phone.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import * as crypto from "crypto";

const storedFiles = new Map<string, Buffer>();
jest.mock("../../services/storage.service", () => {
  const actual = jest.requireActual("../../services/storage.service") as Record<string, unknown>;
  return {
    ...actual,
    storageService: {
      upload: async (options: {
        buffer: Buffer;
        originalName: string;
        mimeType: string;
        folder: string;
        organizationId: string;
      }) => {
        const { Upload } = await import("../../entities/upload.entity");
        const upload = await Upload.create({
          filename: options.originalName,
          originalName: options.originalName,
          path: `${options.organizationId}/${options.folder}/${options.originalName}`,
          mimeType: options.mimeType,
          size: options.buffer.length,
          storageType: "local",
          folder: options.folder,
          organizationId: options.organizationId,
        }).save();
        storedFiles.set(upload.id, options.buffer);
        return { upload, url: `/v1/media/${upload.id}` };
      },
      download: async (id: string) => {
        const buffer = storedFiles.get(id);
        if (!buffer) throw new Error(`Upload not found: ${id}`);
        const { Upload } = await import("../../entities/upload.entity");
        return { buffer, upload: await Upload.findOneByOrFail({ id }) };
      },
      delete: async (id: string) => {
        storedFiles.delete(id);
        const { Upload } = await import("../../entities/upload.entity");
        await Upload.delete({ id });
      },
    },
  };
});

const sentEmails: Array<{ to: string; template: string; variables: Record<string, string> }> = [];
jest.mock("../../services/email.service", () => ({
  emailService: {
    initialize: async () => undefined,
    sendTemplateEmail: async (email: {
      to: string;
      template: string;
      variables: Record<string, string>;
    }) => {
      sentEmails.push(email);
    },
  },
  getOrganizationLocale: async () => "en",
}));

import { AppDataSource } from "@server/database/data-source";
import { redisService } from "@server/services/redis.service";
import { privacyService } from "@server/services/privacy.service";
import { jobQueueService } from "@server/services/job-queue.service";
import { CustomerService } from "@server/services/customer.service";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";
import { User } from "@server/entities/user.entity";
import { purgeAuditLogs } from "../helpers/audit-logs";

const ORG_A = "b0000001-0000-4000-8000-0000000000a1";
const ORG_B = "b0000001-0000-4000-8000-0000000000b2";
const STAFF_EMAIL = "erasure-staff@example.com";
const STAFF_FIRST = "Zebulonia";
const STAFF_LAST = "Quistworth";
const CUSTOMER_EMAIL = "erasure-shopper@example.com";
const CUSTOMER_PHONE = "+15550199887";

/** Every table.column (text, varchar, jsonb, json) holding the needle, outside audit_logs. */
async function findPii(needle: string): Promise<string[]> {
  const columns: Array<{ table_name: string; column_name: string }> = await AppDataSource.query(
    `SELECT c.table_name, c.column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
       AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
       -- Audit log retention and anonymization belong to the audit-log work.
       AND c.table_name <> 'audit_logs'`,
  );
  const hits: string[] = [];
  for (const { table_name, column_name } of columns) {
    const [row] = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}"::text ILIKE $1`,
      [`%${needle}%`],
    );
    if (row.n > 0) hits.push(`${table_name}.${column_name}`);
  }
  return hits;
}

async function runQueuedJobs(): Promise<void> {
  for (let i = 0; i < 5; i++) await jobQueueService.processNextJob();
}

function tokenFrom(url: string): string {
  return new URL(url).searchParams.get("token")!;
}

async function cleanup(): Promise<void> {
  const ids = [ORG_A, ORG_B];
  await AppDataSource.query(`DELETE FROM privacy_requests WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(
    `DELETE FROM privacy_requests WHERE email IN ($1, $2) OR email LIKE 'erased:%'`,
    [STAFF_EMAIL, CUSTOMER_EMAIL],
  );
  await AppDataSource.query(`DELETE FROM jobs WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM customers WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM uploads WHERE organization_id = ANY($1)`, [ids]);
  await purgeAuditLogs(`organization_id = ANY($1) OR original_organization_id = ANY($1)`, [ids]);
  const users: Array<{ id: string }> = await AppDataSource.query(
    `SELECT id FROM users WHERE email = $1 OR organization_id = ANY($2) OR id IN (
       SELECT user_id FROM user_organizations WHERE organization_id = ANY($2))`,
    [STAFF_EMAIL, ids],
  );
  const userIds = users.map((u) => u.id);
  await purgeAuditLogs(`user_id = ANY($1)`, [userIds]);
  await AppDataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
  await AppDataSource.query(`DELETE FROM users WHERE email LIKE 'deleted-%@deleted.local'`);
  await AppDataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [ids]);
}

describe("privacy requests: jobs, exports and erasure", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    if (!redisService.isConnected()) await redisService.initialize();
  });

  afterAll(async () => {
    await cleanup();
    await AppDataSource.destroy();
    await redisService.shutdown();
  });

  let userId: string;

  beforeEach(async () => {
    await cleanup();
    sentEmails.length = 0;
    storedFiles.clear();
    const { rateLimitService } = await import("@server/services/rate-limit.service");
    await rateLimitService.resetRateLimit(STAFF_EMAIL, "email", "privacy-request");
    await rateLimitService.resetRateLimit("10.0.0.9", "ip", "privacy-request");
    await rateLimitService.resetRateLimit(`10.0.0.9:${STAFF_EMAIL}`, "combined");

    for (const [id, slug] of [
      [ORG_A, "privacy-erasure-a"],
      [ORG_B, "privacy-erasure-b"],
    ]) {
      await AppDataSource.query(
        `INSERT INTO organizations (id, name, slug, is_active) VALUES ($1, $2, $3, true)`,
        [id, `Erasure ${slug}`, `${slug}-${Date.now()}`],
      );
    }
    const [user] = await AppDataSource.query(
      `INSERT INTO users (email, password, first_name, last_name, is_active, organization_id, role)
       VALUES ($1, 'x', $2, $3, true, $4, 'member') RETURNING id`,
      [STAFF_EMAIL, STAFF_FIRST, STAFF_LAST, ORG_A],
    );
    userId = user.id;
    for (const org of [ORG_A, ORG_B]) {
      await AppDataSource.query(
        `INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'member')`,
        [userId, org],
      );
    }
  });

  /** A customer with a conversation and the conversation-scoped records that quote them. */
  async function seedCustomer(): Promise<{ customerId: string; conversationId: string }> {
    const [customer] = await AppDataSource.query(
      `INSERT INTO customers (organization_id, email, phone, name, external_id, notes)
       VALUES ($1, $2, $3, 'Shopper Person', 'ext-erasure-1', $4) RETURNING id`,
      [ORG_A, CUSTOMER_EMAIL, CUSTOMER_PHONE, CUSTOMER_EMAIL],
    );
    const pii = `I am ${CUSTOMER_EMAIL}, call ${CUSTOMER_PHONE}`;
    const [conversation] = await AppDataSource.query(
      `INSERT INTO conversations (organization_id, customer_id, title, channel, status, metadata,
         summary, resolution_metadata, assigned_user_id)
       VALUES ($1, $2, $3::varchar, 'web', 'open', $4::jsonb, $3::text, $4::jsonb, $5) RETURNING id`,
      [
        ORG_A,
        customer.id,
        pii,
        JSON.stringify({
          contactEmail: CUSTOMER_EMAIL,
          referrer: `https://x.test/?e=${CUSTOMER_EMAIL}`,
        }),
        userId,
      ],
    );
    const conversationId = conversation.id;
    await AppDataSource.query(
      `INSERT INTO messages (conversation_id, content, type, sender, original_content, attachments, metadata)
       VALUES ($1, $2::text, 'Customer', 'customer', $2::text, $3::jsonb, $4::jsonb),
              ($1, 'Hello there', 'HumanAgent', $5, NULL, NULL, $6::jsonb)`,
      [
        conversationId,
        pii,
        JSON.stringify([
          { id: "a1", name: `${CUSTOMER_EMAIL}.pdf`, url: "x", type: "pdf", size: 1 },
        ]),
        JSON.stringify({ phone: CUSTOMER_PHONE }),
        `${STAFF_FIRST} ${STAFF_LAST}`,
        JSON.stringify({ sentByUserId: userId, agentFirstName: STAFF_FIRST }),
      ],
    );
    await AppDataSource.query(
      `INSERT INTO team_questions (organization_id, conversation_id, question, customer_message, asked_at)
       VALUES ($1, $2, $3::text, $3::text, now())`,
      [ORG_A, conversationId, pii],
    );
    await AppDataSource.query(
      `INSERT INTO action_log (organization_id, conversation_id, tool_name, read_only, args, outcome, duration_ms)
       VALUES ($1, $2, 'lookup_order', true, $3, 'success', 1)`,
      [ORG_A, conversationId, JSON.stringify({ email: CUSTOMER_EMAIL })],
    );
    await AppDataSource.query(
      `INSERT INTO pending_actions (organization_id, conversation_id, tool_name, category, args,
         hold_reason, status, idempotency_key, expires_at)
       VALUES ($1, $2, 'refund', 'money', $3, 'amount', 'pending', $4, now() + interval '1 day')`,
      [ORG_A, conversationId, JSON.stringify({ phone: CUSTOMER_PHONE }), crypto.randomUUID()],
    );
    await AppDataSource.query(
      `INSERT INTO order_conversation_links (organization_id, conversation_id, order_key, order_label, source)
       VALUES ($1, $2, '1001', $3, 'tool_output')`,
      [ORG_A, conversationId, CUSTOMER_EMAIL],
    );
    await AppDataSource.query(
      `INSERT INTO notification_deliveries (organization_id, conversation_id, user_id,
         cycle_started_at, step, channel, status, detail)
       VALUES ($1, $2, $3, now(), 'first', 'email', 'sent', $4)`,
      [ORG_A, conversationId, userId, CUSTOMER_EMAIL],
    );
    await AppDataSource.query(
      `INSERT INTO insight_issues (organization_id, source, conversation_id, polarity, action_type,
         severity, confidence, relevance, summary, snippet)
       VALUES ($1, 'conversation', $2, 'negative', 'doc', 'low', 0.5, 1, 'Refund unclear', $3)`,
      [ORG_A, conversationId, pii],
    );
    return { customerId: customer.id, conversationId };
  }

  it("erases a staff user everywhere through a queued deletion job", async () => {
    await seedCustomer();
    await AppDataSource.query(
      `INSERT INTO sessions (user_id, expires_at, last_activity, ip_address, user_agent)
       VALUES ($1, now() + interval '1 day', now(), '10.1.2.3', 'Agent')`,
      [userId],
    );
    await AppDataSource.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://push', 'k', 'a')`,
      [userId],
    );
    await AppDataSource.query(
      `INSERT INTO auth_codes (user_id, code_hash, expires_at) VALUES ($1, 'h', now())`,
      [userId],
    );
    await AppDataSource.query(
      `INSERT INTO organization_invitations (organization_id, email, role, token_hash, expires_at, invited_by)
       VALUES ($1, $2, 'member', 'h1', now() + interval '1 day', NULL),
              ($1, 'someone-else@example.com', 'member', 'h2', now() + interval '1 day', $3)`,
      [ORG_B, STAFF_EMAIL, userId],
    );
    await AppDataSource.query(
      `INSERT INTO uploads (filename, original_name, path, mime_type, size, storage_type, folder,
         organization_id, uploaded_by_id)
       VALUES ('f.png', 'f.png', 'p', 'image/png', 1, 'local', 'documents', $1, $2)`,
      [ORG_A, userId],
    );
    const tokenVersionBefore = (await User.findOneByOrFail({ id: userId })).tokenVersion;

    const { requestId } = await privacyService.requestDeletion(STAFF_EMAIL, "10.0.0.9", "UA");
    const verification = sentEmails.find((e) => e.template === "privacy-deletion-request")!;
    await privacyService.confirmDeletion(tokenFrom(verification.variables.verificationUrl));
    await runQueuedJobs();

    const request = await PrivacyRequest.findOneByOrFail({ id: requestId });
    expect(request.status).toBe("completed");
    expect(sentEmails.some((e) => e.template === "privacy-deletion-complete")).toBe(true);

    for (const needle of [STAFF_EMAIL, STAFF_FIRST, STAFF_LAST]) {
      expect(await findPii(needle)).toEqual([]);
    }
    const counts = await AppDataSource.query(
      `SELECT
         (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS sessions,
         (SELECT count(*)::int FROM push_subscriptions WHERE user_id = $1) AS push,
         (SELECT count(*)::int FROM auth_codes WHERE user_id = $1) AS codes,
         (SELECT count(*)::int FROM user_organizations WHERE user_id = $1) AS memberships,
         (SELECT count(*)::int FROM uploads WHERE uploaded_by_id = $1) AS uploads,
         (SELECT count(*)::int FROM conversations WHERE assigned_user_id = $1) AS assigned,
         (SELECT count(*)::int FROM organization_invitations WHERE invited_by = $1) AS invited`,
      [userId],
    );
    expect(counts[0]).toEqual({
      sessions: 0,
      push: 0,
      codes: 0,
      memberships: 0,
      uploads: 0,
      assigned: 0,
      invited: 0,
    });
    const user = await User.findOneOrFail({ where: { id: userId }, withDeleted: true });
    expect(user.tokenVersion).toBe(tokenVersionBefore + 1);
    expect(user.isActive).toBe(false);
  });

  it("answers a deletion request for an unknown email without sending anything", async () => {
    const unknown = "nobody-here@example.com";
    const { rateLimitService } = await import("@server/services/rate-limit.service");
    await rateLimitService.resetRateLimit(unknown, "email", "privacy-request");
    await rateLimitService.resetRateLimit(`10.0.0.9:${unknown}`, "combined");
    const { requestId } = await privacyService.requestDeletion(unknown, "10.0.0.9", "UA");
    expect((await privacyService.getStatus(requestId)).status).toBe("pending_verification");
    expect(sentEmails).toHaveLength(0);
    await PrivacyRequest.delete({ id: requestId });
  });

  it("erases a customer deleted from the dashboard, conversations included", async () => {
    const { conversationId } = await seedCustomer();
    expect(await new CustomerService().deleteCustomer((await seedLookup()).id, ORG_A)).toBe(true);

    for (const needle of [CUSTOMER_EMAIL, CUSTOMER_PHONE, "ext-erasure-1"]) {
      expect(await findPii(needle)).toEqual([]);
    }
    const [conversation] = await AppDataSource.query(
      `SELECT customer_id, deleted_at FROM conversations WHERE id = $1`,
      [conversationId],
    );
    expect(conversation.customer_id).toBeNull();
    expect(conversation.deleted_at).not.toBeNull();
  });

  async function seedLookup(): Promise<{ id: string }> {
    const [row] = await AppDataSource.query(`SELECT id FROM customers WHERE email = $1`, [
      CUSTOMER_EMAIL,
    ]);
    return row;
  }

  it("erases a customer through a verified customer deletion request", async () => {
    await seedCustomer();
    const { requestId } = await privacyService.requestCustomerDeletion(ORG_A, {
      type: "phone",
      value: CUSTOMER_PHONE,
    });
    const verification = sentEmails.find((e) => e.template === "privacy-deletion-request")!;
    // The email goes to the address stored on the customer record.
    expect(verification.to).toBe(CUSTOMER_EMAIL);
    await privacyService.confirmDeletion(tokenFrom(verification.variables.verificationUrl));
    await runQueuedJobs();

    expect((await PrivacyRequest.findOneByOrFail({ id: requestId })).status).toBe("completed");
    const auditRows: Array<{ action: string; user_id: string | null }> = await AppDataSource.query(
      `SELECT action, user_id FROM audit_logs WHERE changes->>'requestId' = $1 ORDER BY created_at`,
      [requestId],
    );
    expect(auditRows.map((row) => row.action)).toEqual([
      "customer.privacy.deletion.request",
      "customer.privacy.deletion.confirm",
      "customer.privacy.deletion.complete",
    ]);
    expect(auditRows.every((row) => row.user_id === null)).toBe(true);
    for (const needle of [CUSTOMER_EMAIL, CUSTOMER_PHONE]) {
      expect(await findPii(needle)).toEqual([]);
    }
  });

  it("refuses a customer export for an identifier that matches no customer", async () => {
    await expect(
      privacyService.requestCustomerExport(ORG_A, { type: "email", value: "stranger@example.com" }),
    ).rejects.toThrow("No customer found");
    expect(sentEmails).toHaveLength(0);
  });

  it("exports every membership into a stored ZIP that is deleted after its last download", async () => {
    const { requestId } = await privacyService.requestExport(STAFF_EMAIL, "10.0.0.9", "UA");
    const verification = sentEmails.find((e) => e.template === "privacy-export-request")!;
    await privacyService.confirmExport(tokenFrom(verification.variables.verificationUrl));
    await runQueuedJobs();

    const request = await PrivacyRequest.findOneByOrFail({ id: requestId });
    expect(request.status).toBe("completed");
    const ready = sentEmails.find((e) => e.template === "privacy-export-ready")!;
    const downloadToken = tokenFrom(ready.variables.downloadUrl);
    // Only the hash of the download token is stored, in the request and the job.
    const [job] = await AppDataSource.query(`SELECT title, data, result FROM jobs WHERE id = $1`, [
      request.jobId,
    ]);
    expect(JSON.stringify([request.metadata, job])).not.toContain(downloadToken);
    expect(JSON.stringify(job)).not.toContain(STAFF_EMAIL);

    const expiresAt = request.getExportExpiresAt()!;
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86400000)).toBe(7);

    await expect(privacyService.downloadExport(requestId, "wrong", "10.0.0.9")).rejects.toThrow(
      "Invalid download token",
    );
    const { buffer } = await privacyService.downloadExport(requestId, downloadToken, "10.0.0.9");
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const unzipped = buffer.toString("latin1");
    expect(unzipped).toContain("data.json");

    // maxDownloads defaults to 1: the file is gone and the link is spent.
    expect(storedFiles.size).toBe(0);
    await expect(
      privacyService.downloadExport(requestId, downloadToken, "10.0.0.9"),
    ).rejects.toThrow();
    expect((await privacyService.getStatus(requestId)).downloadAvailable).toBe(false);

    const data = await (privacyService as any).collectUserData(userId);
    expect(data.personalData.organizations.map((o: { id: string }) => o.id).sort()).toEqual(
      [ORG_A, ORG_B].sort(),
    );
  });

  it("queues a stale privacy job again, then fails it after the last attempt", async () => {
    const { requestId } = await privacyService.requestExport(STAFF_EMAIL, "10.0.0.9", "UA");
    const verification = sentEmails.find((e) => e.template === "privacy-export-request")!;
    const { jobId } = await privacyService.confirmExport(
      tokenFrom(verification.variables.verificationUrl),
    );
    const stale = async () =>
      AppDataSource.query(
        `UPDATE jobs SET status = 'processing', updated_at = now() - interval '3 hours' WHERE id = $1`,
        [jobId],
      );

    await stale();
    expect(await privacyService.requeueStaleJobs()).toEqual({ requeued: 1, failed: 0 });
    let [job] = await AppDataSource.query(`SELECT status FROM jobs WHERE id = $1`, [jobId]);
    expect(job.status).toBe("queued");

    await stale();
    await privacyService.requeueStaleJobs();
    await stale();
    expect(await privacyService.requeueStaleJobs()).toEqual({ requeued: 0, failed: 1 });
    [job] = await AppDataSource.query(`SELECT status FROM jobs WHERE id = $1`, [jobId]);
    expect(job.status).toBe("failed");
    expect((await PrivacyRequest.findOneByOrFail({ id: requestId })).status).toBe("failed");
  });

  it("anonymizes privacy requests past their retention", async () => {
    const { requestId } = await privacyService.requestExport(STAFF_EMAIL, "10.0.0.9", "UA");
    await AppDataSource.query(
      `UPDATE privacy_requests SET created_at = now() - interval '400 days', status = 'expired'
       WHERE id = $1`,
      [requestId],
    );
    expect(await privacyService.anonymizeExpiredRequests()).toBeGreaterThanOrEqual(1);
    const request = await PrivacyRequest.findOneByOrFail({ id: requestId });
    expect(request.email).toBe(
      `erased:${crypto.createHash("sha256").update(STAFF_EMAIL).digest("hex")}`,
    );
    expect(request.ipAddress).toBeNull();
    expect(request.userAgent).toBeNull();
  });
});

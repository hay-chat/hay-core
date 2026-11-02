/**
 * Provider-initiated privacy requests: a plugin's privacy.eraseCustomer /
 * privacy.exportCustomer calls (store redact / data-request webhooks) and the
 * Meta-style signed data-deletion callback with its status page.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import * as crypto from "crypto";
import type { Request, Response } from "express";

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
      delete: async (id: string) => {
        storedFiles.delete(id);
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

// The deauthorize path stops the org's worker; no workers run in tests.
jest.mock("../../services/plugin-manager.service", () => ({
  pluginManagerService: { stopPluginWorker: async () => undefined },
}));

import { AppDataSource } from "@server/database/data-source";
import { redisService } from "@server/services/redis.service";
import { jobQueueService } from "@server/services/job-queue.service";
import { pluginApiTrpcRouter } from "@server/routes/v1/plugin-api/trpc";
import { mintPluginApiToken } from "@server/lib/plugin-api-token";
import { webhookRouterService } from "@server/services/webhook-router.service";
import type { PluginAuthContext } from "@server/trpc/middleware/plugin-auth";

const ORG_A = "c0000001-0000-4000-8000-0000000000a1";
const ORG_B = "c0000001-0000-4000-8000-0000000000b2";
const PLUGIN_ID = "hay-plugin-provider-privacy-test";
const REGISTRY_ID = "c0000001-0000-4000-8000-0000000000f1";
const SECRET_ENV = "PROVIDER_PRIVACY_TEST_SECRET";
const SECRET = "test-app-secret";
const EMAIL = "provider-shopper@example.com";

function caller(organizationId: string, capabilities = ["privacy"]) {
  const token = mintPluginApiToken(organizationId, PLUGIN_ID, capabilities);
  return pluginApiTrpcRouter.createCaller({
    user: null,
    organizationId: null,
    req: { headers: { authorization: `Bearer ${token}` } },
    res: {},
  } as unknown as PluginAuthContext);
}

/**
 * Run the queue until this suite's jobs are done. Another suite's worker on the
 * same database may claim one of them, so this waits rather than counting runs.
 */
async function runQueuedJobs(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await jobQueueService.processNextJob();
    const [row] = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM jobs
       WHERE organization_id = ANY($1) AND status IN ('queued', 'processing')`,
      [[ORG_A, ORG_B]],
    );
    if (row.n === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Queued privacy jobs did not finish");
}

async function seedCustomer(
  organizationId: string,
  fields: { email?: string; phone?: string; externalId?: string },
): Promise<string> {
  const [customer] = await AppDataSource.query(
    `INSERT INTO customers (organization_id, email, phone, name, external_id)
     VALUES ($1, $2, $3, 'Provider Shopper', $4) RETURNING id`,
    [organizationId, fields.email ?? null, fields.phone ?? null, fields.externalId ?? null],
  );
  await AppDataSource.query(
    `INSERT INTO conversations (organization_id, customer_id, title, channel, status)
     VALUES ($1, $2, 'Hello', 'web', 'open')`,
    [organizationId, customer.id],
  );
  return customer.id;
}

async function customerExists(id: string): Promise<boolean> {
  const rows = await AppDataSource.query(`SELECT 1 FROM customers WHERE id = $1`, [id]);
  return rows.length > 0;
}

function signedRequest(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

function fakeResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    type() {
      return res;
    },
    send(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const MERCHANT_OWNER = "provider-owner@example.com";
const MERCHANT_ADMIN = "provider-admin@example.com";
const MERCHANT_MEMBER = "provider-member@example.com";
const MERCHANT_FORMER_ADMIN = "provider-former-admin@example.com";

/** Org members of every kind; only the active owner and admin should get an export. */
async function seedMembers(organizationId: string): Promise<void> {
  for (const [email, role, active] of [
    [MERCHANT_OWNER, "owner", true],
    [MERCHANT_ADMIN, "admin", true],
    [MERCHANT_MEMBER, "member", true],
    [MERCHANT_FORMER_ADMIN, "admin", false],
  ] as const) {
    const [user] = await AppDataSource.query(
      `INSERT INTO users (email, password, first_name, is_active, organization_id, role)
       VALUES ($1, 'x', 'Merchant', true, $2, $3) RETURNING id`,
      [email, organizationId, role],
    );
    await AppDataSource.query(
      `INSERT INTO user_organizations (user_id, organization_id, role, is_active)
       VALUES ($1, $2, $3, $4)`,
      [user.id, organizationId, role, active],
    );
  }
}

async function cleanup(): Promise<void> {
  const ids = [ORG_A, ORG_B];
  await AppDataSource.query(`DELETE FROM users WHERE email = ANY($1)`, [
    [MERCHANT_OWNER, MERCHANT_ADMIN, MERCHANT_MEMBER, MERCHANT_FORMER_ADMIN],
  ]);
  await AppDataSource.query(
    `DELETE FROM privacy_requests WHERE organization_id = ANY($1) OR metadata ->> 'source' = $2`,
    [ids, `plugin:${PLUGIN_ID}`],
  );
  await AppDataSource.query(`DELETE FROM jobs WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM customers WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM uploads WHERE organization_id = ANY($1)`, [ids]);
  await AppDataSource.query(`DELETE FROM plugin_instances WHERE plugin_id = $1`, [REGISTRY_ID]);
  await AppDataSource.query(`DELETE FROM plugin_registry WHERE id = $1`, [REGISTRY_ID]);
  await AppDataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [ids]);
}

describe("provider-initiated privacy requests", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    if (!redisService.isConnected()) await redisService.initialize();
    process.env[SECRET_ENV] = SECRET;
  });

  afterAll(async () => {
    await cleanup();
    await AppDataSource.destroy();
    await redisService.shutdown();
  });

  beforeEach(async () => {
    await cleanup();
    sentEmails.length = 0;
    storedFiles.clear();
    for (const [id, slug] of [
      [ORG_A, "provider-privacy-a"],
      [ORG_B, "provider-privacy-b"],
    ]) {
      await AppDataSource.query(
        `INSERT INTO organizations (id, name, slug, is_active) VALUES ($1, $2, $3, true)`,
        [id, slug, `${slug}-${Date.now()}`],
      );
    }
  });

  describe("privacy.eraseCustomer", () => {
    it("erases the matching customers of the caller's organization only", async () => {
      const byEmail = await seedCustomer(ORG_A, { email: EMAIL.toUpperCase() });
      const byPhone = await seedCustomer(ORG_A, { phone: "+55 (11) 99999-0000" });
      const byWaId = await seedCustomer(ORG_A, { externalId: "5511999990000" });
      const unrelated = await seedCustomer(ORG_A, { email: "someone-else@example.com" });
      const otherOrg = await seedCustomer(ORG_B, { email: EMAIL });

      const result = await caller(ORG_A)["privacy.eraseCustomer"]({
        emails: [EMAIL],
        phones: ["+5511999990000"],
        reference: "nuvemshop:customer:1",
      });
      expect(result.matched).toBe(3);
      expect(result.requestIds).toHaveLength(3);

      await runQueuedJobs();

      expect(await customerExists(byEmail)).toBe(false);
      expect(await customerExists(byPhone)).toBe(false);
      expect(await customerExists(byWaId)).toBe(false);
      expect(await customerExists(unrelated)).toBe(true);
      expect(await customerExists(otherOrg)).toBe(true);

      const requests = await AppDataSource.query(
        `SELECT status FROM privacy_requests WHERE id = ANY($1)`,
        [result.requestIds],
      );
      expect(requests.map((r: { status: string }) => r.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      // The provider answers the subject: no deletion email from Hay.chat.
      expect(sentEmails).toHaveLength(0);
    });

    it("finds a channel identity the customer took over in a merge", async () => {
      const [merged] = await AppDataSource.query(
        `INSERT INTO customers (organization_id, external_id, external_metadata)
         VALUES ($1, 'psid-own', $2::jsonb) RETURNING id`,
        [ORG_A, JSON.stringify({ _mergedExternalIds: ["psid-merged"] })],
      );
      const result = await caller(ORG_A)["privacy.eraseCustomer"]({
        externalIds: ["psid-merged"],
      });
      expect(result.matched).toBe(1);
      await runQueuedJobs();
      expect(await customerExists(merged.id)).toBe(false);
    });

    it("keeps one job per customer while a retried delivery is in flight", async () => {
      await seedCustomer(ORG_A, { email: EMAIL });
      const first = await caller(ORG_A)["privacy.eraseCustomer"]({ emails: [EMAIL] });
      const retry = await caller(ORG_A)["privacy.eraseCustomer"]({ emails: [EMAIL] });
      expect(retry.requestIds).toEqual(first.requestIds);
      const [jobs] = await AppDataSource.query(
        `SELECT count(*)::int AS n FROM jobs WHERE organization_id = $1`,
        [ORG_A],
      );
      expect(jobs.n).toBe(1);
    });

    it("ignores phone fragments too short to identify anyone", async () => {
      await seedCustomer(ORG_A, { phone: "1234" });
      const result = await caller(ORG_A)["privacy.eraseCustomer"]({ phones: ["1234"] });
      expect(result.matched).toBe(0);
    });

    it("requires the privacy capability and at least one identifier", async () => {
      await expect(
        caller(ORG_A, ["customers"])["privacy.eraseCustomer"]({ emails: [EMAIL] }),
      ).rejects.toThrow();
      await expect(caller(ORG_A)["privacy.eraseCustomer"]({})).rejects.toThrow();
    });
  });

  describe("privacy.exportCustomer", () => {
    it("emails the export to the store's owners and admins, never the shopper", async () => {
      await seedMembers(ORG_A);
      const customerId = await seedCustomer(ORG_A, { email: EMAIL });
      await seedCustomer(ORG_A, { phone: "+5511988887777" });

      const result = await caller(ORG_A)["privacy.exportCustomer"]({
        emails: [EMAIL],
        phones: ["+5511988887777"],
        reference: "nuvemshop:data_request:456",
      });
      expect(result).toMatchObject({ matched: 2, undeliverable: 0 });
      expect(result.requestIds).toHaveLength(2);

      await runQueuedJobs();

      expect(sentEmails.map((e) => e.to).sort()).toEqual([
        MERCHANT_ADMIN,
        MERCHANT_ADMIN,
        MERCHANT_OWNER,
        MERCHANT_OWNER,
      ]);
      expect(sentEmails.every((e) => e.template === "privacy-export-ready-merchant")).toBe(true);
      const forShopper = sentEmails.find((e) => e.variables.customerId === customerId)!;
      expect(forShopper.variables).toMatchObject({
        customerLabel: `Provider Shopper · ${EMAIL}`,
        requestReference: "nuvemshop:data_request:456",
      });

      const requests = await AppDataSource.query(
        `SELECT status, email, metadata FROM privacy_requests WHERE id = ANY($1)`,
        [result.requestIds],
      );
      for (const request of requests) {
        expect(request.status).toBe("completed");
        expect(request.email).toBe("");
        expect(request.metadata).toMatchObject({
          source: `plugin:${PLUGIN_ID}`,
          reference: "nuvemshop:data_request:456",
        });
      }
    });

    it("records a request with no matching customer as answered, sending nothing", async () => {
      await seedMembers(ORG_A);
      const result = await caller(ORG_A)["privacy.exportCustomer"]({
        emails: ["nobody@example.com"],
        reference: "nuvemshop:data_request:457",
      });
      expect(result).toEqual({ matched: 0, requestIds: [], undeliverable: 0 });
      const [request] = await AppDataSource.query(
        `SELECT status, customer_id, job_id, metadata FROM privacy_requests
         WHERE organization_id = $1 AND type = 'export'`,
        [ORG_A],
      );
      expect(request).toMatchObject({ status: "completed", customer_id: null, job_id: null });
      expect(request.metadata).toMatchObject({
        outcome: "no_match",
        reference: "nuvemshop:data_request:457",
      });
      expect(sentEmails).toHaveLength(0);
    });

    it("records the export as undeliverable when the store has no owner or admin email", async () => {
      const customerId = await seedCustomer(ORG_A, { email: EMAIL });
      const result = await caller(ORG_A)["privacy.exportCustomer"]({ emails: [EMAIL] });
      expect(result).toEqual({ matched: 1, requestIds: [], undeliverable: 1 });
      const [request] = await AppDataSource.query(
        `SELECT status, customer_id, job_id, error_message, metadata FROM privacy_requests
         WHERE organization_id = $1 AND type = 'export'`,
        [ORG_A],
      );
      expect(request).toMatchObject({
        status: "failed",
        customer_id: customerId,
        job_id: null,
        error_message: "No owner or admin with an email to deliver the export to",
      });
      expect(request.metadata).toMatchObject({ outcome: "no_recipient" });
      const [jobs] = await AppDataSource.query(
        `SELECT count(*)::int AS n FROM jobs WHERE organization_id = $1`,
        [ORG_A],
      );
      expect(jobs.n).toBe(0);
      expect(sentEmails).toHaveLength(0);
    });
  });

  describe("signed data-deletion callback", () => {
    const descriptor = {
      format: "signed-request" as const,
      param: "signed_request",
      secretEnv: SECRET_ENV,
      keyPath: "user_id",
    };

    async function installPlugin(organizationId: string): Promise<void> {
      await AppDataSource.query(
        `INSERT INTO plugin_registry (id, plugin_id, name, version, plugin_path, manifest)
         VALUES ($1, $2, 'Test', '0.0.0', 'test', '{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
        [REGISTRY_ID, PLUGIN_ID],
      );
      await AppDataSource.query(
        `INSERT INTO plugin_instances (organization_id, plugin_id, enabled) VALUES ($1, $2, true)`,
        [organizationId, REGISTRY_ID],
      );
    }

    async function callback(userId: string) {
      const res = fakeResponse();
      await webhookRouterService.handleDeauthorization(
        {
          method: "POST",
          body: { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: userId }) },
        } as unknown as Request,
        res as unknown as Response,
        PLUGIN_ID,
        descriptor,
        "data-deletion",
      );
      return res;
    }

    async function status(code: string) {
      const res = fakeResponse();
      await webhookRouterService.handleDataDeletionStatus(
        { query: { code } } as unknown as Request,
        res as unknown as Response,
        PLUGIN_ID,
      );
      return res;
    }

    it("erases the person's customers where the plugin is installed and reports status", async () => {
      await installPlugin(ORG_A);
      const inPluginOrg = await seedCustomer(ORG_A, { externalId: "psid-123" });
      const elsewhere = await seedCustomer(ORG_B, { externalId: "psid-123" });

      const res = await callback("psid-123");
      expect(res.statusCode).toBe(200);
      const { url, confirmation_code: code } = res.body as {
        url: string;
        confirmation_code: string;
      };
      expect(url).toContain(`/v1/plugins/${PLUGIN_ID}/data-deletion?code=${code}`);

      const pending = await status(code);
      expect(pending.statusCode).toBe(200);
      expect(String(pending.body)).toContain("in progress");

      await runQueuedJobs();

      expect(await customerExists(inPluginOrg)).toBe(false);
      expect(await customerExists(elsewhere)).toBe(true);
      expect(String((await status(code)).body)).toContain("Data deletion completed");
    });

    it("issues a completed code when nothing is held for the person", async () => {
      await installPlugin(ORG_A);
      const res = await callback("psid-unknown");
      const { confirmation_code: code } = res.body as { confirmation_code: string };
      expect(String((await status(code)).body)).toContain("Data deletion completed");
    });

    it("answers 404 for a code it never issued and rejects a bad signature", async () => {
      expect((await status(crypto.randomUUID())).statusCode).toBe(404);

      const res = fakeResponse();
      await webhookRouterService.handleDeauthorization(
        { method: "POST", body: { signed_request: "bad.signature" } } as unknown as Request,
        res as unknown as Response,
        PLUGIN_ID,
        descriptor,
        "data-deletion",
      );
      expect(res.statusCode).toBe(400);
    });
  });
});

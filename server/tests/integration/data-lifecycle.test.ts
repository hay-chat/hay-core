/**
 * Automatic data lifecycle against a real database: retention sweeps, storage
 * purge on organization deletion and document file orphans. Every case checks
 * that the rows next to the target, and other organizations, are untouched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import * as crypto from "crypto";

const deletedObjects: Array<{ type: string; path: string }> = [];
const deletedUploads: string[] = [];
const deletedPublicUrls: string[] = [];
let failObjectDelete = false;

jest.mock("../../services/storage.service", () => {
  const actual = jest.requireActual("../../services/storage.service") as Record<string, unknown>;
  return {
    ...actual,
    storageService: {
      delete: async (id: string) => {
        deletedUploads.push(id);
        const { Upload } = await import("../../entities/upload.entity");
        await Upload.delete({ id });
      },
      deleteObject: async (type: string, path: string) => {
        if (failObjectDelete) throw new Error("storage down");
        deletedObjects.push({ type, path });
      },
      deleteByPublicUrl: async (url: string) => {
        deletedPublicUrls.push(url);
      },
    },
  };
});

import { AppDataSource } from "@server/database/data-source";
import { redisService } from "@server/services/redis.service";
import { dataRetentionService } from "@server/services/data-retention.service";
import { organizationService } from "@server/services/organization.service";
import { privacyService } from "@server/services/privacy.service";
import { mediaUrl } from "@server/services/media-url.service";
import {
  deleteDocumentAttachments,
  drainStoragePurgeQueue,
  sweepOrphanDocumentFiles,
} from "@server/services/storage-purge.service";
import type { Organization } from "@server/entities/organization.entity";
import { purgeAuditLogs } from "../helpers/audit-logs";

const RETAINING = "c0000001-0000-4000-8000-0000000000a1";
const OTHER_RETAINING = "c0000001-0000-4000-8000-0000000000a2";
const NO_RETENTION = "c0000001-0000-4000-8000-0000000000b1";
const ORGS = [RETAINING, OTHER_RETAINING, NO_RETENTION];
const OLD = "2020-01-01T00:00:00Z";

async function cleanup(): Promise<void> {
  await AppDataSource.query(
    `DELETE FROM storage_purge_queue WHERE storage_path LIKE 'lifecycle/%'`,
  );
  await AppDataSource.query(
    `DELETE FROM privacy_requests WHERE organization_id = ANY($1) OR original_organization_id = ANY($1)`,
    [ORGS],
  );
  await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM customers WHERE organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM uploads WHERE organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM documents WHERE organization_id = ANY($1)`, [ORGS]);
  await purgeAuditLogs(`organization_id = ANY($1) OR original_organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM users WHERE email LIKE 'lifecycle-%@example.com'`);
  await AppDataSource.query(`DELETE FROM users WHERE email LIKE 'deleted-%@deleted.local'`);
  await AppDataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [ORGS]);
}

async function seedConversation(
  organizationId: string,
  fields: {
    status?: string;
    closedAt?: string | null;
    createdAt?: string;
    legalHold?: boolean;
    customerId?: string | null;
    deletedAt?: string | null;
  } = {},
): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO conversations (organization_id, customer_id, title, channel, status, closed_at,
       created_at, legal_hold, deleted_at, summary, resolution_metadata, spam_reason, stuck_reason,
       last_processing_error, metadata)
     VALUES ($1, $2, 'Secret title', 'web', $3, $4, $5, $6, $7, 'Secret summary', '{"a":1}',
       'Secret spam', 'Secret stuck', 'Secret error', '{"a":1}')
     RETURNING id`,
    [
      organizationId,
      fields.customerId ?? null,
      fields.status ?? "closed",
      fields.closedAt === undefined ? OLD : fields.closedAt,
      fields.createdAt ?? OLD,
      fields.legalHold ?? false,
      fields.deletedAt ?? null,
    ],
  );
  await AppDataSource.query(
    `INSERT INTO messages (conversation_id, content, type, sender) VALUES ($1, 'Secret', 'Customer', 'customer')`,
    [row.id],
  );
  return row.id;
}

async function seedConversationRecords(organizationId: string, id: string): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO team_questions (organization_id, conversation_id, question, customer_message, asked_at)
     VALUES ($1, $2, 'q', 'Secret', now())`,
    [organizationId, id],
  );
  await AppDataSource.query(
    `INSERT INTO action_log (organization_id, conversation_id, tool_name, read_only, args, outcome, duration_ms)
     VALUES ($1, $2, 'lookup', true, '{"a":"Secret"}', 'success', 1)`,
    [organizationId, id],
  );
  await AppDataSource.query(
    `INSERT INTO pending_actions (organization_id, conversation_id, tool_name, category, args,
       hold_reason, status, idempotency_key, expires_at)
     VALUES ($1, $2, 'refund', 'money', '{"a":"Secret"}', 'amount', 'pending', $3, now())`,
    [organizationId, id, crypto.randomUUID()],
  );
  await AppDataSource.query(
    `INSERT INTO order_conversation_links (organization_id, conversation_id, order_key, order_label, source)
     VALUES ($1, $2, '1001', 'x', 'tool_output')`,
    [organizationId, id],
  );
  await AppDataSource.query(
    `INSERT INTO insight_issues (organization_id, source, conversation_id, polarity, action_type,
       severity, confidence, relevance, summary)
     VALUES ($1, 'conversation', $2, 'negative', 'doc', 'low', 0.5, 1, 'Refund unclear')`,
    [organizationId, id],
  );
}

async function seedUpload(
  organizationId: string,
  folder: string,
  options: { createdAt?: string; customerId?: string; uploadedById?: string } = {},
): Promise<{ id: string; filename: string; path: string }> {
  const filename = `${crypto.randomUUID()}.png`;
  const path = `lifecycle/${organizationId}/${filename}`;
  const [row] = await AppDataSource.query(
    `INSERT INTO uploads (filename, original_name, path, mime_type, size, storage_type, folder,
       organization_id, customer_id, uploaded_by_id, created_at)
     VALUES ($1, 'f.png', $2, 'image/png', 1, 'local', $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
     RETURNING id`,
    [
      filename,
      path,
      folder,
      organizationId,
      options.customerId ?? null,
      options.uploadedById ?? null,
      options.createdAt ?? null,
    ],
  );
  return { id: row.id, filename, path };
}

async function seedCustomer(organizationId: string, updatedAt = OLD): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO customers (organization_id, email, updated_at) VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, `${crypto.randomUUID()}@example.com`, updatedAt],
  );
  return row.id;
}

async function exists(table: string, id: string): Promise<boolean> {
  const rows = await AppDataSource.query(`SELECT 1 FROM "${table}" WHERE id = $1`, [id]);
  return rows.length > 0;
}

async function conversationRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await AppDataSource.query(`SELECT * FROM conversations WHERE id = $1`, [id]);
  return row;
}

async function countFor(table: string, conversationId: string): Promise<number> {
  const [row] = await AppDataSource.query(
    `SELECT count(*)::int AS n FROM "${table}" WHERE conversation_id = $1`,
    [conversationId],
  );
  return row.n;
}

describe("data lifecycle", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    if (!redisService.isConnected()) await redisService.initialize();
  });

  afterAll(async () => {
    await cleanup();
    await AppDataSource.destroy();
    await redisService.shutdown();
  });

  beforeEach(async () => {
    await cleanup();
    deletedObjects.length = 0;
    deletedUploads.length = 0;
    deletedPublicUrls.length = 0;
    failObjectDelete = false;
    for (const [id, settings] of [
      [RETAINING, { retentionDays: 30 }],
      [OTHER_RETAINING, { retentionDays: 30 }],
      [NO_RETENTION, {}],
    ] as const) {
      await AppDataSource.query(
        `INSERT INTO organizations (id, name, slug, is_active, settings) VALUES ($1, 'Lifecycle', $2, true, $3)`,
        [id, `lifecycle-${id}-${Date.now()}`, JSON.stringify(settings)],
      );
    }
  });

  describe("conversation retention", () => {
    it("anonymizes an expired conversation completely and keeps its insight issue", async () => {
      const id = await seedConversation(RETAINING);
      await seedConversationRecords(RETAINING, id);

      const result = await dataRetentionService.anonymizeExpiredConversations();
      expect(result.conversationsAnonymized).toBeGreaterThanOrEqual(1);

      const row = await conversationRow(id);
      expect(row.deleted_at).not.toBeNull();
      expect(row.title).toBe("[Anonymized]");
      for (const column of [
        "customer_id",
        "summary",
        "resolution_metadata",
        "spam_reason",
        "stuck_reason",
        "last_processing_error",
        "metadata",
      ]) {
        expect(row[column]).toBeNull();
      }
      for (const table of [
        "messages",
        "team_questions",
        "action_log",
        "pending_actions",
        "order_conversation_links",
      ]) {
        expect(await countFor(table, id)).toBe(0);
      }
      expect(await countFor("insight_issues", id)).toBe(1);
    });

    it("leaves everything that is not an expired, ended, unheld conversation of that organization", async () => {
      const recent = await seedConversation(RETAINING, {
        closedAt: new Date().toISOString(),
        createdAt: OLD,
      });
      const open = await seedConversation(RETAINING, { status: "open", closedAt: null });
      const held = await seedConversation(RETAINING, { legalHold: true });
      const heldNeverClosed = await seedConversation(RETAINING, {
        status: "open",
        closedAt: null,
        legalHold: true,
      });
      const noRetentionClosed = await seedConversation(NO_RETENTION);
      const noRetentionOpen = await seedConversation(NO_RETENTION, {
        status: "open",
        closedAt: null,
      });
      const otherOrgRecent = await seedConversation(OTHER_RETAINING, {
        closedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      await dataRetentionService.anonymizeExpiredConversations();

      for (const id of [
        recent,
        open,
        held,
        heldNeverClosed,
        noRetentionClosed,
        noRetentionOpen,
        otherOrgRecent,
      ]) {
        const row = await conversationRow(id);
        expect(row.deleted_at).toBeNull();
        expect(row.title).toBe("Secret title");
        expect(await countFor("messages", id)).toBe(1);
      }
    });

    it("works through a backlog in batches with one audit row each", async () => {
      await AppDataSource.query(
        `INSERT INTO conversations (organization_id, title, channel, status, closed_at, created_at)
         SELECT $1, 't', 'web', 'closed', $2::timestamptz, $2::timestamptz FROM generate_series(1, 205)`,
        [RETAINING, OLD],
      );

      await dataRetentionService.anonymizeExpiredConversations();

      const [{ remaining }] = await AppDataSource.query(
        `SELECT count(*)::int AS remaining FROM conversations
         WHERE organization_id = $1 AND deleted_at IS NULL`,
        [RETAINING],
      );
      expect(remaining).toBe(0);
      const audits: Array<{ metadata: { conversationIds: string[] } }> = await AppDataSource.query(
        `SELECT metadata FROM audit_logs WHERE organization_id = $1 AND action = 'retention.cleanup'`,
        [RETAINING],
      );
      expect(audits.map((a) => a.metadata.conversationIds.length).sort((a, b) => b - a)).toEqual([
        200, 5,
      ]);
    });
  });

  describe("customer sweep", () => {
    it("deletes a stale customer with only anonymized conversations, in that organization only", async () => {
      const stale = await seedCustomer(RETAINING);
      await seedConversation(RETAINING, { customerId: stale, deletedAt: OLD });
      const media = await seedUpload(RETAINING, "conversation-media", { customerId: stale });

      const result = await dataRetentionService.sweepExpiredCustomers();

      expect(result.customersDeleted).toBe(1);
      expect(await exists("customers", stale)).toBe(false);
      expect(deletedUploads).toEqual([media.id]);
    });

    it("keeps active, recent, held, requesting and no-retention customers", async () => {
      const live = await seedCustomer(RETAINING);
      await seedConversation(RETAINING, { customerId: live, status: "open", closedAt: null });
      const recent = await seedCustomer(RETAINING, new Date().toISOString());
      const held = await seedCustomer(RETAINING);
      await seedConversation(RETAINING, { customerId: held, deletedAt: OLD, legalHold: true });
      const requesting = await seedCustomer(RETAINING);
      await AppDataSource.query(
        `INSERT INTO privacy_requests (email, type, status, subject_type, customer_id, organization_id,
           identifier_type, identifier_value)
         VALUES ('lifecycle-r@example.com', 'deletion', 'verified', 'customer', $1, $2, 'email', 'lifecycle-r@example.com')`,
        [requesting, RETAINING],
      );
      const noRetention = await seedCustomer(NO_RETENTION);

      await dataRetentionService.sweepExpiredCustomers();

      for (const id of [live, recent, held, requesting, noRetention]) {
        expect(await exists("customers", id)).toBe(true);
      }
    });
  });

  describe("organization deletion", () => {
    it("queues every stored file, keeps privacy requests, and leaves other organizations alone", async () => {
      const upload = await seedUpload(RETAINING, "conversation-media");
      const otherUpload = await seedUpload(OTHER_RETAINING, "conversation-media");
      const [request] = await AppDataSource.query(
        `INSERT INTO privacy_requests (email, type, status, subject_type, organization_id,
           identifier_type, identifier_value)
         VALUES ('lifecycle-p@example.com', 'export', 'completed', 'customer', $1, 'email', 'lifecycle-p@example.com')
         RETURNING id`,
        [RETAINING],
      );

      await organizationService.deleteWithData({ id: RETAINING } as Organization, {
        source: "operator",
      });

      expect(await exists("organizations", RETAINING)).toBe(false);
      expect(await exists("uploads", upload.id)).toBe(false);
      expect(await exists("uploads", otherUpload.id)).toBe(true);

      const [kept] = await AppDataSource.query(
        `SELECT organization_id, original_organization_id FROM privacy_requests WHERE id = $1`,
        [request.id],
      );
      expect(kept.organization_id).toBeNull();
      expect(kept.original_organization_id).toBe(RETAINING);

      expect(await drainStoragePurgeQueue()).toEqual({ deleted: 1, failed: 0 });
      expect(deletedObjects).toEqual([{ type: "local", path: upload.path }]);
      const [{ n }] = await AppDataSource.query(
        `SELECT count(*)::int AS n FROM storage_purge_queue WHERE storage_path LIKE 'lifecycle/%'`,
      );
      expect(n).toBe(0);
    });

    it("clears an avatar stored in the deleted organization", async () => {
      const [user] = await AppDataSource.query(
        `INSERT INTO users (email, password, is_active) VALUES ('lifecycle-a@example.com', 'x', true) RETURNING id`,
      );
      const avatar = await seedUpload(RETAINING, "avatars", { uploadedById: user.id });
      await AppDataSource.query(`UPDATE users SET avatar_url = $2 WHERE id = $1`, [
        user.id,
        `https://cdn.test/${avatar.path}`,
      ]);

      await organizationService.deleteWithData({ id: RETAINING } as Organization, {
        source: "operator",
      });

      const [row] = await AppDataSource.query(`SELECT avatar_url FROM users WHERE id = $1`, [
        user.id,
      ]);
      expect(row.avatar_url).toBeNull();
    });

    it("keeps a queue entry whose object could not be deleted, counting the attempt", async () => {
      const upload = await seedUpload(RETAINING, "conversation-media");
      await organizationService.deleteWithData({ id: RETAINING } as Organization, {
        source: "operator",
      });

      failObjectDelete = true;
      expect(await drainStoragePurgeQueue()).toEqual({ deleted: 0, failed: 1 });

      const [entry] = await AppDataSource.query(
        `SELECT attempts, last_error FROM storage_purge_queue WHERE storage_path = $1`,
        [upload.path],
      );
      expect(entry.attempts).toBe(1);
      expect(entry.last_error).toBe("storage down");
    });
  });

  describe("document files", () => {
    async function seedDocument(organizationId: string, fields: { content?: string }) {
      const [row] = await AppDataSource.query(
        `INSERT INTO documents (title, organization_id, content) VALUES ('d', $1, $2) RETURNING id`,
        [organizationId, fields.content ?? ""],
      );
      return row.id as string;
    }

    it("sweeps only old document files no document of that organization names", async () => {
      const orphan = await seedUpload(RETAINING, "document-images", { createdAt: OLD });
      const orphanAttachment = await seedUpload(RETAINING, `documents/${RETAINING}`, {
        createdAt: OLD,
      });
      const used = await seedUpload(RETAINING, "document-images", { createdAt: OLD });
      await seedDocument(RETAINING, { content: `![x](${mediaUrl(used.id)})` });
      const recent = await seedUpload(RETAINING, "document-images");
      const otherFolder = await seedUpload(RETAINING, "avatars", { createdAt: OLD });
      const foreignReference = await seedUpload(OTHER_RETAINING, "document-images", {
        createdAt: OLD,
      });
      await seedDocument(RETAINING, { content: mediaUrl(foreignReference.id) });

      await sweepOrphanDocumentFiles();

      expect(await exists("uploads", orphan.id)).toBe(false);
      expect(await exists("uploads", orphanAttachment.id)).toBe(false);
      expect(await exists("uploads", foreignReference.id)).toBe(false);
      expect(await exists("uploads", used.id)).toBe(true);
      expect(await exists("uploads", recent.id)).toBe(true);
      expect(await exists("uploads", otherFolder.id)).toBe(true);
    });

    it("deletes a document's attachments, never another organization's upload", async () => {
      const own = await seedUpload(RETAINING, `documents/${RETAINING}`);
      const foreign = await seedUpload(OTHER_RETAINING, `documents/${OTHER_RETAINING}`);

      await deleteDocumentAttachments(RETAINING, [
        { url: mediaUrl(own.id) },
        { url: mediaUrl(foreign.id) },
        { url: "https://example.com/not-ours.pdf" },
      ]);

      expect(await exists("uploads", own.id)).toBe(false);
      expect(await exists("uploads", foreign.id)).toBe(true);
    });
  });

  it("deletes a staff user's avatar file on erasure", async () => {
    const [user] = await AppDataSource.query(
      `INSERT INTO users (email, password, is_active, avatar_url)
       VALUES ('lifecycle-e@example.com', 'x', true, 'https://cdn.test/avatars/a.png') RETURNING id`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (privacyService as any).executeDataDeletion(user.id);

    expect(deletedPublicUrls).toEqual(["https://cdn.test/avatars/a.png"]);
  });
});

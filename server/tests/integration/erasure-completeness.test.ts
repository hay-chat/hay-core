/**
 * Everything an erasure and an export must reach beyond the conversation
 * itself, the record that lets erasures be re-applied after a restore, the cap
 * on insight text and the widget consent record. Every case checks that rows
 * of other customers and other organizations stay untouched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import * as crypto from "crypto";

jest.mock("../../services/storage.service", () => {
  const actual = jest.requireActual("../../services/storage.service") as Record<string, unknown>;
  return {
    ...actual,
    storageService: {
      delete: async () => undefined,
      deleteObject: async () => undefined,
      deleteByPublicUrl: async () => undefined,
    },
  };
});

import { AppDataSource } from "@server/database/data-source";
import { redisService } from "@server/services/redis.service";
import { dataRetentionService } from "@server/services/data-retention.service";
import { findPendingErasures, replayErasures } from "@server/services/erasure-replay.service";
import { privacyService } from "@server/services/privacy.service";
import { recordWebchatConsent } from "@server/services/webchat/consent-record.service";
import { purgeAuditLogs } from "../helpers/audit-logs";

const ORG = "c0000002-0000-4000-8000-0000000000a1";
const OTHER_ORG = "c0000002-0000-4000-8000-0000000000a2";
const NO_RETENTION = "c0000002-0000-4000-8000-0000000000b1";
const ORGS = [ORG, OTHER_ORG, NO_RETENTION];
const EMAIL = "erasure.subject@example.com";
const PHONE = "+15550100200";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function cleanup(): Promise<void> {
  // The ledger refuses DELETE; organization ids repeat between test runs.
  await AppDataSource.query(`TRUNCATE erasure_ledger`);
  for (const table of ["test_transcripts", "test_cases", "simulation_runs", "disputes"]) {
    await AppDataSource.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [ORGS]);
  }
  await AppDataSource.query(
    `DELETE FROM privacy_requests WHERE organization_id = ANY($1) OR original_organization_id = ANY($1)`,
    [ORGS],
  );
  await AppDataSource.query(`DELETE FROM conversations WHERE organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM customers WHERE organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM uploads WHERE organization_id = ANY($1)`, [ORGS]);
  await purgeAuditLogs(`organization_id = ANY($1) OR original_organization_id = ANY($1)`, [ORGS]);
  await AppDataSource.query(`DELETE FROM users WHERE email LIKE 'erasure-test-%@example.com'`);
  await AppDataSource.query(`DELETE FROM users WHERE email LIKE 'deleted-%@deleted.local'`);
  await AppDataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [ORGS]);
}

async function seedCustomer(organizationId: string, email = EMAIL, phone = PHONE): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO customers (organization_id, email, phone) VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, email, phone],
  );
  return row.id;
}

async function seedConversation(
  organizationId: string,
  customerId: string | null,
  legalHold = false,
): Promise<{ id: string; messageId: string }> {
  const [row] = await AppDataSource.query(
    `INSERT INTO conversations (organization_id, customer_id, title, channel, status, legal_hold)
     VALUES ($1, $2, 'Title', 'web', 'closed', $3) RETURNING id`,
    [organizationId, customerId, legalHold],
  );
  const [message] = await AppDataSource.query(
    `INSERT INTO messages (conversation_id, content, type, sender)
     VALUES ($1, 'Hello', 'Customer', 'customer') RETURNING id`,
    [row.id],
  );
  return { id: row.id, messageId: message.id };
}

async function seedTranscript(organizationId: string, text: string): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO test_transcripts (organization_id, source, turns, turn_count, import_batch_id)
     VALUES ($1, 'csv', $2, 1, gen_random_uuid()) RETURNING id`,
    [organizationId, JSON.stringify([{ role: "customer", content: text }])],
  );
  return row.id;
}

async function seedTestCase(
  organizationId: string,
  text: string,
  sourceRef: string | null = null,
): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO test_cases (organization_id, title, seed, source, source_ref)
     VALUES ($1, 'Case', $2, 'conversation', $3) RETURNING id`,
    [organizationId, JSON.stringify([{ role: "customer", content: text }]), sourceRef],
  );
  return row.id;
}

async function seedRunItem(
  organizationId: string,
  fields: { text?: string; conversationId?: string; status?: string; position: number },
): Promise<string> {
  const [run] = await AppDataSource.query(
    `INSERT INTO simulation_runs (organization_id) VALUES ($1) RETURNING id`,
    [organizationId],
  );
  const [row] = await AppDataSource.query(
    `INSERT INTO simulation_run_items (run_id, organization_id, position, status, seed, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      run.id,
      organizationId,
      fields.position,
      fields.status ?? "completed",
      JSON.stringify([{ role: "customer", content: fields.text ?? "unrelated" }]),
      fields.conversationId ?? null,
    ],
  );
  return row.id;
}

async function exists(table: string, id: string): Promise<boolean> {
  const rows = await AppDataSource.query(`SELECT 1 FROM "${table}" WHERE id = $1`, [id]);
  return rows.length > 0;
}

async function runItem(id: string): Promise<{ seed: unknown[]; status: string }> {
  const [row] = await AppDataSource.query(
    `SELECT seed, status FROM simulation_run_items WHERE id = $1`,
    [id],
  );
  return row;
}

async function ledgerCount(subjectId: string): Promise<number> {
  const [row] = await AppDataSource.query(
    `SELECT count(*)::int AS n FROM erasure_ledger WHERE subject_id = $1`,
    [subjectId],
  );
  return row.n;
}

async function seedIssue(
  organizationId: string,
  createdAt: string,
  conversationId: string | null = null,
): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO insight_issues (organization_id, source, conversation_id, polarity, action_type,
       severity, confidence, relevance, summary, snippet, created_at)
     VALUES ($1, 'conversation', $2, 'negative', 'doc', 'low', 0.5, 1, 'Summary', 'Snippet', $3)
     RETURNING id`,
    [organizationId, conversationId, createdAt],
  );
  return row.id;
}

async function seedCluster(organizationId: string, lastSeenAt: string): Promise<string> {
  const [row] = await AppDataSource.query(
    `INSERT INTO insight_clusters (organization_id, polarity, action_type, signature, snippets,
       paraphrases, last_seen_at)
     VALUES ($1, 'negative', 'doc', $3, '["Snippet"]', '["Paraphrase"]', $2) RETURNING id`,
    [organizationId, lastSeenAt, crypto.randomUUID()],
  );
  return row.id;
}

async function clusterText(id: string): Promise<{ snippets: unknown[]; paraphrases: unknown[] }> {
  const [row] = await AppDataSource.query(
    `SELECT snippets, paraphrases FROM insight_clusters WHERE id = $1`,
    [id],
  );
  return row;
}

describe("erasure completeness", () => {
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
    for (const [id, settings] of [
      [ORG, { retentionDays: 30 }],
      [OTHER_ORG, { retentionDays: 30 }],
      [NO_RETENTION, {}],
    ] as const) {
      await AppDataSource.query(
        `INSERT INTO organizations (id, name, slug, is_active, settings) VALUES ($1, 'Erasure', $2, true, $3)`,
        [id, `erasure-${id}-${Date.now()}`, JSON.stringify(settings)],
      );
    }
  });

  describe("simulation data on customer erasure", () => {
    it("removes what names or came from the customer, in that organization only", async () => {
      const customerId = await seedCustomer(ORG);
      const { id: conversationId, messageId } = await seedConversation(ORG, customerId);
      const otherCustomer = await seedCustomer(ORG, "someone.else@example.com", "+15550999888");
      const { id: otherConversation } = await seedConversation(ORG, otherCustomer);

      const byEmail = await seedTranscript(ORG, `Mail me at ${EMAIL.toUpperCase()} please`);
      const byPhone = await seedTranscript(ORG, `Call ${PHONE}`);
      const unrelatedTranscript = await seedTranscript(ORG, "Where is my parcel?");
      const foreignTranscript = await seedTranscript(OTHER_ORG, `Mail me at ${EMAIL}`);

      const caseBySeed = await seedTestCase(ORG, `I am ${EMAIL}`);
      const caseByMessage = await seedTestCase(ORG, "no identity", messageId);
      const caseByReplay = await seedTestCase(
        ORG,
        "no identity",
        `conversation:${conversationId}:3`,
      );
      const unrelatedCase = await seedTestCase(
        ORG,
        "no identity",
        `conversation:${otherConversation}:3`,
      );
      const foreignCase = await seedTestCase(OTHER_ORG, `I am ${EMAIL}`);

      const itemByConversation = await seedRunItem(ORG, { conversationId, position: 0 });
      const itemBySeed = await seedRunItem(ORG, { text: EMAIL, position: 0, status: "pending" });
      const unrelatedItem = await seedRunItem(ORG, {
        conversationId: otherConversation,
        position: 0,
      });
      const foreignItem = await seedRunItem(OTHER_ORG, { text: EMAIL, position: 0 });

      expect(await privacyService.eraseCustomer(customerId, ORG)).toBe(true);

      for (const id of [byEmail, byPhone]) expect(await exists("test_transcripts", id)).toBe(false);
      for (const id of [caseBySeed, caseByMessage, caseByReplay]) {
        expect(await exists("test_cases", id)).toBe(false);
      }
      expect((await runItem(itemByConversation)).seed).toEqual([]);
      expect(await runItem(itemBySeed)).toEqual({ seed: [], status: "failed" });

      expect(await exists("test_transcripts", unrelatedTranscript)).toBe(true);
      expect(await exists("test_transcripts", foreignTranscript)).toBe(true);
      expect(await exists("test_cases", unrelatedCase)).toBe(true);
      expect(await exists("test_cases", foreignCase)).toBe(true);
      expect((await runItem(unrelatedItem)).seed).toHaveLength(1);
      expect((await runItem(foreignItem)).seed).toHaveLength(1);
    });

    it("ignores identifiers too short to tell apart", async () => {
      const customerId = await seedCustomer(ORG, "a@b.co", "123");
      const transcript = await seedTranscript(ORG, "contact a@b.co 123 anywhere");

      await privacyService.eraseCustomer(customerId, ORG);

      expect(await exists("test_transcripts", transcript)).toBe(true);
    });
  });

  describe("customer export", () => {
    it("includes the linked records without staff details or other customers' data", async () => {
      const customerId = await seedCustomer(ORG);
      const { id: conversationId } = await seedConversation(ORG, customerId);
      const otherCustomer = await seedCustomer(ORG, "someone.else@example.com", "+15550999888");
      const { id: otherConversation } = await seedConversation(ORG, otherCustomer);
      const [{ id: staff }] = await AppDataSource.query(
        `INSERT INTO users (email, password, first_name, last_name, is_active)
         VALUES ('erasure-test-staff@example.com', 'x', 'Sam', 'Staff', true) RETURNING id`,
      );

      for (const [id, question] of [
        [conversationId, "Mine"],
        [otherConversation, "Theirs"],
      ]) {
        await AppDataSource.query(
          `INSERT INTO team_questions (organization_id, conversation_id, question, customer_message, asked_at, answered_by)
           VALUES ($1, $2, $3, 'msg', now(), $4)`,
          [ORG, id, question, staff],
        );
      }
      await AppDataSource.query(
        `INSERT INTO pending_actions (organization_id, conversation_id, tool_name, category, args,
           hold_reason, status, idempotency_key, expires_at, decided_by, decision_note)
         VALUES ($1, $2, 'refund', 'money', '{"a":1}', 'amount', 'approved', $3, now(), $4, 'Staff note')`,
        [ORG, conversationId, crypto.randomUUID(), staff],
      );
      await AppDataSource.query(
        `INSERT INTO action_log (organization_id, conversation_id, tool_name, read_only, args, outcome, duration_ms)
         VALUES ($1, $2, 'lookup', true, '{"a":1}', 'success', 1)`,
        [ORG, conversationId],
      );
      await AppDataSource.query(
        `INSERT INTO order_conversation_links (organization_id, conversation_id, order_key, order_label, source)
         VALUES ($1, $2, '1001', '#1001', 'tool_output')`,
        [ORG, conversationId],
      );
      for (const [org, key] of [
        [ORG, "1001"],
        [ORG, "2002"],
        [OTHER_ORG, "1001"],
      ]) {
        await AppDataSource.query(
          `INSERT INTO disputes (organization_id, plugin_id, external_id, status, order_key, provider_url)
           VALUES ($1, 'stripe', $2, 'needs_response', $3, 'https://provider.example/d')`,
          [org, crypto.randomUUID(), key],
        );
      }
      await AppDataSource.query(
        `INSERT INTO uploads (filename, original_name, path, mime_type, size, storage_type, folder,
           organization_id, customer_id)
         VALUES ('f.png', 'photo.png', 'erasure/f.png', 'image/png', 1, 'local', 'x', $1, $2)`,
        [ORG, customerId],
      );
      await recordWebchatConsent({
        organizationId: ORG,
        action: "grant",
        mode: "strict",
        conversationId,
      });
      await seedTranscript(ORG, `I am ${EMAIL}`);
      await seedTranscript(OTHER_ORG, `I am ${EMAIL}`);
      await seedTestCase(ORG, EMAIL);
      await seedRunItem(ORG, { conversationId, position: 0 });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await (privacyService as any).collectCustomerData(customerId, ORG);
      const personal = data.personalData;

      expect(personal.teamQuestions.map((q: { question: string }) => q.question)).toEqual(["Mine"]);
      expect(personal.pendingActions).toHaveLength(1);
      expect(personal.actionLog).toHaveLength(1);
      expect(personal.disputes).toHaveLength(1);
      expect(personal.uploads[0].originalName).toBe("photo.png");
      expect(personal.consentRecords).toHaveLength(1);
      expect(personal.testTranscripts).toHaveLength(1);
      expect(personal.testCases).toHaveLength(1);
      expect(personal.simulationItems).toHaveLength(1);

      const serialized = JSON.stringify(personal);
      expect(serialized).not.toContain(staff);
      expect(serialized).not.toContain("Staff note");
      expect(serialized).not.toContain("provider.example");
    });
  });

  describe("erasure ledger", () => {
    it("records an erasure and cannot be changed afterwards", async () => {
      const customerId = await seedCustomer(ORG);

      await privacyService.eraseCustomer(customerId, ORG);

      expect(await ledgerCount(customerId)).toBe(1);
      await expect(
        AppDataSource.query(`DELETE FROM erasure_ledger WHERE subject_id = $1`, [customerId]),
      ).rejects.toThrow(/append-only/);
      await expect(
        AppDataSource.query(
          `UPDATE erasure_ledger SET organization_id = NULL WHERE subject_id = $1`,
          [customerId],
        ),
      ).rejects.toThrow(/append-only/);
    });

    it("records nothing when the customer was not in that organization", async () => {
      const customerId = await seedCustomer(OTHER_ORG);

      expect(await privacyService.eraseCustomer(customerId, ORG)).toBe(false);

      expect(await ledgerCount(customerId)).toBe(0);
      expect(await exists("customers", customerId)).toBe(true);
    });

    it("applies erasures again after a restore, only with apply, and only once", async () => {
      const erased = await seedCustomer(ORG);
      const untouched = await seedCustomer(ORG, "someone.else@example.com", "+15550999888");
      await privacyService.eraseCustomer(erased, ORG);

      expect(await findPendingErasures()).toEqual([]);

      // A restore brings the row back.
      await AppDataSource.query(
        `INSERT INTO customers (id, organization_id, email) VALUES ($1, $2, $3)`,
        [erased, ORG, EMAIL],
      );

      const dryRun = await replayErasures({ apply: false });
      expect(dryRun.pending.map((p) => p.subjectId)).toEqual([erased]);
      expect(dryRun.applied).toBe(0);
      expect(await exists("customers", erased)).toBe(true);

      const applied = await replayErasures({ apply: true });
      expect(applied).toMatchObject({ applied: 1, failed: 0 });
      expect(await exists("customers", erased)).toBe(false);
      expect(await exists("customers", untouched)).toBe(true);
      expect(await ledgerCount(erased)).toBe(1);

      expect(await findPendingErasures()).toEqual([]);
    });

    it("replays staff users whose row came back with its identity", async () => {
      const [user] = await AppDataSource.query(
        `INSERT INTO users (email, password, first_name, last_name, is_active)
         VALUES ('erasure-test-user@example.com', 'x', 'Ann', 'Lee', true) RETURNING id`,
      );
      await AppDataSource.query(
        `INSERT INTO erasure_ledger (subject_type, subject_id) VALUES ('user', $1)`,
        [user.id],
      );

      expect(await replayErasures({ apply: true })).toMatchObject({ applied: 1, failed: 0 });

      const [row] = await AppDataSource.query(`SELECT email FROM users WHERE id = $1`, [user.id]);
      expect(row.email).toBe(`deleted-${user.id}@deleted.local`);
      expect(await findPendingErasures()).toEqual([]);
    });

    it("replays an organization deletion before anything inside it", async () => {
      const customerId = await seedCustomer(OTHER_ORG);
      await AppDataSource.query(
        `INSERT INTO erasure_ledger (subject_type, subject_id, organization_id)
         VALUES ('customer', $1, $2), ('organization', $2, $2)`,
        [customerId, OTHER_ORG],
      );

      expect((await findPendingErasures()).map((p) => p.subjectType)).toEqual([
        "organization",
        "customer",
      ]);
      expect(await replayErasures({ apply: true })).toMatchObject({ applied: 2, failed: 0 });

      expect(await exists("organizations", OTHER_ORG)).toBe(false);
      expect(await exists("organizations", ORG)).toBe(true);
    });
  });

  describe("insight text expiry", () => {
    it("removes issues past twice the retention period, in retaining organizations only", async () => {
      const expired = await seedIssue(ORG, daysAgo(61));
      const withinCap = await seedIssue(ORG, daysAgo(59));
      const noRetention = await seedIssue(NO_RETENTION, daysAgo(4000));
      const { id: heldConversation } = await seedConversation(ORG, null, true);
      const held = await seedIssue(ORG, daysAgo(61), heldConversation);

      const totals = await dataRetentionService.expireInsightText();

      expect(totals.issuesDeleted).toBe(1);
      expect(await exists("insight_issues", expired)).toBe(false);
      expect(await exists("insight_issues", withinCap)).toBe(true);
      expect(await exists("insight_issues", noRetention)).toBe(true);
      expect(await exists("insight_issues", held)).toBe(true);
    });

    it("clears the text of clusters quiet past the cap and keeps the cluster", async () => {
      const quiet = await seedCluster(ORG, daysAgo(61));
      const active = await seedCluster(ORG, daysAgo(59));
      const noRetention = await seedCluster(NO_RETENTION, daysAgo(4000));

      await dataRetentionService.expireInsightText();

      expect(await clusterText(quiet)).toEqual({ snippets: [], paraphrases: [] });
      expect((await clusterText(active)).snippets).toEqual(["Snippet"]);
      expect((await clusterText(noRetention)).snippets).toEqual(["Snippet"]);
    });
  });

  describe("widget consent record", () => {
    async function events(organizationId: string): Promise<Array<Record<string, unknown>>> {
      return AppDataSource.query(
        `SELECT conversation_id, action, mode FROM webchat_consent_events WHERE organization_id = $1`,
        [organizationId],
      );
    }

    it("stores the decision with its conversation", async () => {
      const { id: conversationId } = await seedConversation(ORG, null);

      await recordWebchatConsent({
        organizationId: ORG,
        action: "revoke",
        mode: "implicit",
        conversationId,
      });

      expect(await events(ORG)).toEqual([
        { conversation_id: conversationId, action: "revoke", mode: "implicit" },
      ]);
    });

    it("drops a conversation belonging to another organization", async () => {
      const { id: foreign } = await seedConversation(OTHER_ORG, null);

      await recordWebchatConsent({
        organizationId: ORG,
        action: "grant",
        mode: "strict",
        conversationId: foreign,
      });

      expect(await events(ORG)).toEqual([
        { conversation_id: null, action: "grant", mode: "strict" },
      ]);
    });

    it("stores nothing for an unknown organization", async () => {
      const unknown = crypto.randomUUID();

      await recordWebchatConsent({ organizationId: unknown, action: "grant", mode: "strict" });

      expect(await events(unknown)).toEqual([]);
    });
  });
});

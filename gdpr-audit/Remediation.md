# GDPR Remediation Plan: Hay Core Platform

**Document Version:** 1.0
**Last Updated:** 2025-10-08
**Estimated Total Effort:** 8-12 engineering weeks
**Priority Framework:** P0 (Critical) → P1 (High) → P2 (Medium) → P3 (Low)

---

## Remediation Roadmap

### Phase 1: Critical Security & Quick Wins (Week 1)

**Effort:** 3 days | **Risk Reduction:** 30%

#### 1.1 GDPR-003: Enforce Strong JWT Secrets ⚡ IMMEDIATE

**Priority:** P0 | **Effort:** 1 day | **Severity:** High

**What to Do:**

```typescript
// server/config/env.ts
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET must be set and at least 32 characters. Generate with: openssl rand -base64 32",
  );
}
if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
  throw new Error("JWT_REFRESH_SECRET must be set and at least 32 characters.");
}

export const config = {
  jwt: {
    secret: process.env.JWT_SECRET, // Remove || 'default...'
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },
};
```

**Steps:**

1. Remove default fallbacks from `server/config/env.ts:86-89`
2. Add validation at startup (fail fast)
3. Update `.env.example` with generation instructions
4. Add CI check to prevent defaults in code
5. Update deployment docs to require secrets

**Testing:**

- Unset `JWT_SECRET`, verify server fails to start with clear error
- Set weak secret, verify validation rejects
- Generate strong secret, verify startup succeeds

**Files to Modify:**

- [server/config/env.ts:86](server/config/env.ts#L86)
- `.env.example` (create if missing)
- `README.md` or `docs/DEPLOYMENT.md`

---

#### 1.2 GDPR-008: Document Subprocessors ⚡ IMMEDIATE

**Priority:** P0 | **Effort:** 2 days | **Severity:** Medium

**What to Do:**
Create `docs/SUBPROCESSORS.md`:

```markdown
# Hay Subprocessors

Last updated: 2025-10-08

## Active Subprocessors

| Subprocessor        | Purpose                              | Data Processed                        | DPA Link                                                   | Region       | Added   |
| ------------------- | ------------------------------------ | ------------------------------------- | ---------------------------------------------------------- | ------------ | ------- |
| OpenAI LLC          | LLM embeddings, chat completion      | Message content, metadata             | [OpenAI DPA](https://openai.com/enterprise-privacy)        | US (SCCs)    | 2024-01 |
| Amazon Web Services | Database hosting (RDS), storage (S3) | All platform data                     | [AWS GDPR](https://aws.amazon.com/compliance/gdpr-center/) | Configurable | 2024-01 |
| Redis Labs          | Cache, pub/sub messaging             | Session data, temporary message cache | [Redis DPA](https://redis.io/legal/dpa/)                   | Configurable | 2024-01 |

## Notification Policy

Customers will be notified 30 days before any new subprocessor is added via email to organization administrators.

## Data Processing Addendum (DPA)

Hay's standard DPA is available at [link]. It incorporates Standard Contractual Clauses (SCCs) for EEA transfers.

## Subprocessor Security Standards

All subprocessors must meet:

- ISO 27001 or SOC 2 Type II certification
- GDPR-compliant data processing agreements
- Encryption in transit (TLS 1.2+) and at rest (AES-256)
```

**Steps:**

1. Create `docs/SUBPROCESSORS.md`
2. Verify OpenAI DPA terms (check openai.com/enterprise-privacy)
3. Add subprocessor list to privacy policy
4. Create `/v1/subprocessors` API endpoint (optional)
5. Add UI in dashboard settings (optional)

**Testing:**

- Verify all DPA links accessible
- Review OpenAI, AWS, Redis terms
- Validate SCCs in place for non-EEA transfers

**Files to Create:**

- `docs/SUBPROCESSORS.md`
- `docs/DPA-TEMPLATE.md` (optional)

---

### Phase 2: DSAR Infrastructure (Weeks 2-4)

**Effort:** 3 weeks | **Risk Reduction:** 40%

#### 2.1 GDPR-001: Implement DSAR Endpoints

**Priority:** P0 | **Effort:** 3-4 weeks | **Severity:** Critical

**Architecture:**

```
┌─────────────────────────────────────────┐
│ DSAR API (/v1/privacy)                  │
├─────────────────────────────────────────┤
│ POST /export     - Generate data export │
│ POST /delete     - Request erasure      │
│ POST /rectify    - Update personal data │
│ GET  /status/:id - Check request status │
└─────────────────────────────────────────┘
         │
         ├──> Identity Verification (email + code)
         ├──> Data Gathering (async job)
         │    ├─ customers table
         │    ├─ conversations table
         │    ├─ messages table
         │    ├─ embeddings table
         │    └─ documents table
         │
         └──> Output Generation (ZIP for export)
```

**Implementation:**

**Step 1: Create DSAR Router**

```typescript
// server/routes/v1/privacy/index.ts
import { router, publicProcedure } from "@server/trpc/init";
import { z } from "zod";
import { dsarService } from "@server/services/dsar.service";

export const privacyRouter = router({
  // Request data export
  requestExport: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        phone: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Send verification code
      const requestId = await dsarService.initiateExport(input.email);
      return { requestId, message: "Verification code sent to email" };
    }),

  // Verify and execute export
  confirmExport: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        verificationCode: z.string().length(6),
      }),
    )
    .mutation(async ({ input }) => {
      const exportJob = await dsarService.confirmAndExecuteExport(
        input.requestId,
        input.verificationCode,
      );
      return { jobId: exportJob.id, estimatedTime: "5-10 minutes" };
    }),

  // Request data deletion
  requestDeletion: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        confirm: z.literal(true),
      }),
    )
    .mutation(async ({ input }) => {
      const requestId = await dsarService.initiateDeletion(input.email);
      return { requestId, message: "Verification code sent" };
    }),

  // Confirm deletion
  confirmDeletion: publicProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        verificationCode: z.string().length(6),
      }),
    )
    .mutation(async ({ input }) => {
      await dsarService.confirmAndExecuteDeletion(input.requestId, input.verificationCode);
      return { message: "Deletion complete" };
    }),

  // Check status
  getStatus: publicProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ input }) => {
      return await dsarService.getRequestStatus(input.requestId);
    }),

  // Download export
  downloadExport: publicProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        token: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return await dsarService.getExportDownloadUrl(input.jobId, input.token);
    }),
});
```

**Step 2: Create DSAR Service**

```typescript
// server/services/dsar.service.ts
import { customerRepository } from "@server/repositories/customer.repository";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { vectorStoreService } from "@server/services/vector-store.service";
import { AppDataSource } from "@server/database/data-source";
import { createWriteStream } from "fs";
import archiver from "archiver";
import crypto from "crypto";

export class DSARService {
  async initiateExport(email: string): Promise<string> {
    // Create DSAR request record
    const requestId = crypto.randomUUID();
    const verificationCode = crypto.randomInt(100000, 999999).toString();

    await AppDataSource.query(
      `INSERT INTO dsar_requests (id, email, type, verification_code, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [requestId, email, "export", verificationCode, new Date(Date.now() + 3600000), "pending"],
    );

    // Send verification email
    await emailService.send({
      to: email,
      subject: "Verify Your Data Export Request",
      template: "dsar-verification",
      variables: { code: verificationCode, expiresIn: "1 hour" },
    });

    return requestId;
  }

  async confirmAndExecuteExport(requestId: string, code: string) {
    const request = await this.verifyRequest(requestId, code);

    // Create background job
    const job = await jobRepository.create({
      type: "dsar_export",
      status: "queued",
      payload: { email: request.email },
    });

    // Execute in background
    this.executeExport(job.id, request.email);

    return job;
  }

  private async executeExport(jobId: string, email: string) {
    try {
      await jobRepository.update(jobId, { status: "running" });

      // Gather all data
      const customers = await customerRepository.findByEmail(email);
      const data = {
        customers: [],
        conversations: [],
        messages: [],
        documents: [],
        embeddings: [],
      };

      for (const customer of customers) {
        data.customers.push({
          id: customer.id,
          email: customer.email,
          phone: customer.phone,
          name: customer.name,
          external_id: customer.external_id,
          created_at: customer.created_at,
        });

        const conversations = await conversationRepository.findByCustomer(customer.id);
        for (const conv of conversations) {
          data.conversations.push({
            id: conv.id,
            status: conv.status,
            created_at: conv.created_at,
            closed_at: conv.closed_at,
          });

          // Get messages
          const messages = conv.messages || [];
          data.messages.push(
            ...messages.map((m) => ({
              id: m.id,
              conversation_id: conv.id,
              content: m.content,
              type: m.type,
              direction: m.direction,
              created_at: m.created_at,
            })),
          );
        }
      }

      // Create ZIP
      const zipPath = `/tmp/dsar-${jobId}.zip`;
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.pipe(output);
      archive.append(JSON.stringify(data, null, 2), { name: "data.json" });
      archive.append(this.generateReadme(email), { name: "README.txt" });
      await archive.finalize();

      // Upload to S3 or store securely
      const downloadUrl = await this.uploadExport(zipPath, jobId);

      await jobRepository.update(jobId, {
        status: "completed",
        result: { downloadUrl, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });

      // Send download email
      await emailService.send({
        to: email,
        subject: "Your Data Export is Ready",
        template: "dsar-export-ready",
        variables: { downloadUrl, expiresIn: "7 days" },
      });
    } catch (error) {
      await jobRepository.update(jobId, { status: "failed", error: error.message });
    }
  }

  async confirmAndExecuteDeletion(requestId: string, code: string) {
    const request = await this.verifyRequest(requestId, code);

    // Find all customer records
    const customers = await customerRepository.findByEmail(request.email);

    for (const customer of customers) {
      // Delete embeddings
      await vectorStoreService.deleteByCustomerId(customer.organization_id, customer.id);

      // Delete conversations (cascades messages)
      const conversations = await conversationRepository.findByCustomer(customer.id);
      for (const conv of conversations) {
        await conversationRepository.delete(conv.id, customer.organization_id);
      }

      // Delete customer
      await customerRepository.delete(customer.id, customer.organization_id);
    }

    // Log deletion
    await AppDataSource.query(
      `INSERT INTO audit_log (action, email, timestamp) VALUES ($1, $2, $3)`,
      ["dsar_deletion", request.email, new Date()],
    );

    return { deleted: customers.length };
  }
}

export const dsarService = new DSARService();
```

**Step 3: Create Database Entities**

```sql
-- server/database/migrations/YYYYMMDD-AddDSARTables.ts
CREATE TABLE dsar_requests (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'export', 'deletion', 'rectification'
  verification_code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_dsar_email ON dsar_requests(email);
CREATE INDEX idx_dsar_expires ON dsar_requests(expires_at);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  organization_id UUID,
  metadata JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_email ON audit_log(email);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
```

**Testing Checklist:**

- [ ] Create customer with conversations and messages
- [ ] Request export via API, verify verification email sent
- [ ] Confirm export, verify ZIP created with all data
- [ ] Download ZIP, verify JSON structure complete
- [ ] Request deletion, verify all data removed including embeddings
- [ ] Verify audit log entry created
- [ ] Test expired verification code rejection
- [ ] Test rate limiting on DSAR endpoints

**Files to Create:**

- `server/routes/v1/privacy/index.ts`
- `server/services/dsar.service.ts`
- `server/database/migrations/[timestamp]-AddDSARTables.ts`
- `server/templates/email/dsar-verification.template.html`
- `server/templates/email/dsar-export-ready.template.html`

**Dependencies:**

- `archiver` (for ZIP creation)
- `@aws-sdk/client-s3` (for export storage, optional)

---

### Phase 3: Data Retention & Lifecycle (Weeks 5-6)

**Effort:** 2 weeks | **Risk Reduction:** 20%

#### 3.1 GDPR-002: Implement Retention Policies

**Priority:** P0 | **Effort:** 2 weeks | **Severity:** High

**Architecture:**

```
┌────────────────────────────────────┐
│ Retention Worker (Cron: daily)    │
├────────────────────────────────────┤
│ For each organization:             │
│  1. Get retention_days setting     │
│  2. Find expired conversations     │
│  3. Soft-delete conversations      │
│  4. Delete embeddings              │
│  5. Log retention action           │
└────────────────────────────────────┘
```

**Implementation:**

**Step 1: Add Retention Configuration**

```typescript
// server/database/migrations/[timestamp]-AddRetentionSettings.ts
ALTER TABLE organizations ADD COLUMN retention_days INTEGER DEFAULT 90;
ALTER TABLE conversations ADD COLUMN legal_hold BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN deleted_at TIMESTAMP;
```

**Step 2: Create Retention Worker**

```typescript
// server/workers/retention.worker.ts
import { conversationRepository } from "@server/repositories/conversation.repository";
import { vectorStoreService } from "@server/services/vector-store.service";
import { LessThan } from "typeorm";

export class RetentionWorker {
  async run() {
    console.log("[RetentionWorker] Starting retention cleanup...");

    const orgs = await organizationRepository.findAll();
    let totalDeleted = 0;

    for (const org of orgs) {
      const retentionDays = org.retention_days || 90;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      // Find expired conversations
      const expired = await conversationRepository.find({
        where: {
          organization_id: org.id,
          closed_at: LessThan(cutoffDate),
          legal_hold: false,
          deleted_at: null, // Not already soft-deleted
        },
      });

      console.log(
        `[RetentionWorker] Found ${expired.length} expired conversations for org ${org.id}`,
      );

      for (const conversation of expired) {
        // Delete embeddings
        await vectorStoreService.deleteByConversationId(org.id, conversation.id);

        // Soft-delete conversation
        await conversationRepository.update(conversation.id, org.id, {
          deleted_at: new Date(),
        });

        totalDeleted++;
      }
    }

    console.log(`[RetentionWorker] Completed. Soft-deleted ${totalDeleted} conversations.`);

    // Log to audit
    await AppDataSource.query(
      `INSERT INTO audit_log (action, metadata, timestamp) VALUES ($1, $2, $3)`,
      ["retention_cleanup", { totalDeleted }, new Date()],
    );
  }
}

// Schedule daily at 2 AM
export function startRetentionWorker() {
  const worker = new RetentionWorker();

  // Initial run
  worker.run();

  // Daily at 2 AM
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 2 && now.getMinutes() === 0) {
      worker.run();
    }
  }, 60 * 1000); // Check every minute
}
```

**Step 3: Update Queries to Respect Soft Deletes**

```typescript
// server/repositories/conversation.repository.ts
override async findByOrganization(organizationId: string): Promise<Conversation[]> {
  return await this.getRepository().find({
    where: {
      organization_id: organizationId,
      deleted_at: null, // Exclude soft-deleted
    },
    order: { created_at: 'DESC' },
  });
}
```

**Step 4: Add Retention UI in Dashboard**

```vue
<!-- dashboard/pages/settings/retention.vue -->
<template>
  <div class="retention-settings">
    <h2>Data Retention Policy</h2>
    <p>Automatically delete closed conversations after a specified period.</p>

    <FormField label="Retention Period">
      <Select v-model="retentionDays">
        <option value="30">30 days</option>
        <option value="90">90 days (recommended)</option>
        <option value="180">180 days</option>
        <option value="365">1 year</option>
        <option value="0">Never delete (not recommended)</option>
      </Select>
    </FormField>

    <Button @click="saveSettings">Save Retention Policy</Button>
  </div>
</template>
```

**Testing:**

- [ ] Set org retention to 7 days
- [ ] Create conversation, close it, backdate `closed_at` to 8 days ago
- [ ] Run retention worker
- [ ] Verify conversation has `deleted_at` set
- [ ] Verify embeddings deleted
- [ ] Verify conversation excluded from list queries
- [ ] Test `legal_hold=true` exempts conversation from deletion

**Files to Modify/Create:**

- `server/workers/retention.worker.ts` (create)
- `server/database/migrations/[timestamp]-AddRetentionSettings.ts` (create)
- `server/repositories/conversation.repository.ts` (update queries)
- `dashboard/pages/settings/retention.vue` (create)

---

### Phase 4: Security Hardening (Week 7)

**Effort:** 1 week | **Risk Reduction:** 5%

#### 4.1 GDPR-007: Fix Embedding Cascade Deletion

**Priority:** P1 | **Effort:** 1 week | **Severity:** High

**Implementation:**

```typescript
// server/services/vector-store.service.ts
async deleteByConversationId(organizationId: string, conversationId: string): Promise<number> {
  // Delete embeddings linked to conversation messages
  const result = await AppDataSource.query(
    `DELETE FROM embeddings
     WHERE "organization_id" = $1
     AND (
       metadata->>'conversationId' = $2
       OR "document_id" IN (
         SELECT id FROM documents WHERE conversation_id = $2
       )
     )`,
    [organizationId, conversationId]
  );

  console.log(`[VectorStore] Deleted ${result[1]} embeddings for conversation ${conversationId}`);
  return result[1];
}

// server/repositories/conversation.repository.ts
override async delete(id: string, organizationId: string): Promise<void> {
  // 1. Delete embeddings first
  await vectorStoreService.deleteByConversationId(organizationId, id);

  // 2. Delete documents (if any)
  await AppDataSource.query(
    `DELETE FROM documents WHERE conversation_id = $1 AND organization_id = $2`,
    [id, organizationId]
  );

  // 3. Delete conversation (cascades messages via FK)
  await this.getRepository().delete({ id, organization_id: organizationId });

  console.log(`[ConversationRepo] Deleted conversation ${id} and all associated data`);
}
```

**Testing:**

- [ ] Create conversation with 3 messages
- [ ] Verify embeddings created (count > 0 in embeddings table)
- [ ] Delete conversation via repository method
- [ ] Verify embeddings count = 0 for that conversation
- [ ] Verify messages deleted (FK cascade)
- [ ] Add unit test for `deleteByConversationId`

---

#### 4.2 GDPR-004: Add Webhook Replay Protection

**Priority:** P1 | **Effort:** 1 week | **Severity:** Medium

**Implementation:**

```typescript
// server/services/plugin-route.service.ts
private async verifySignature(
  body: unknown,
  signature: string,
  secret: string,
  headerName: string,
  timestamp?: string,
): Promise<boolean> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);

  // Validate timestamp if provided
  if (timestamp) {
    const ts = parseInt(timestamp);
    const now = Math.floor(Date.now() / 1000);

    if (isNaN(ts) || Math.abs(now - ts) > 300) { // 5-minute window
      console.warn(`[Webhook] Timestamp outside tolerance: ${ts} vs ${now}`);
      return false;
    }

    // Check for replay (nonce deduplication)
    const nonce = crypto.createHash('sha256').update(payload + ts).digest('hex');
    const isReplayed = await this.checkNonce(nonce);
    if (isReplayed) {
      console.warn(`[Webhook] Replay detected: nonce ${nonce}`);
      return false;
    }

    // Store nonce for 10 minutes
    await this.storeNonce(nonce, 600);
  } else if (!headerName.toLowerCase().includes('github')) {
    // Require timestamp for non-legacy webhooks
    console.error(`[Webhook] Missing timestamp for ${headerName}`);
    return false;
  }

  // Existing HMAC validation...
  if (headerName.toLowerCase().includes('stripe')) {
    // ...Stripe logic
  } else if (headerName.toLowerCase().includes('github')) {
    // ...GitHub logic
  } else {
    // Default HMAC
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  }
}

private async checkNonce(nonce: string): Promise<boolean> {
  const exists = await redisService.get(`webhook:nonce:${nonce}`);
  return !!exists;
}

private async storeNonce(nonce: string, ttl: number): Promise<void> {
  await redisService.set(`webhook:nonce:${nonce}`, '1', ttl);
}
```

**Update Webhook Config:**

```typescript
// server/types/plugin.types.ts
export interface WebhookConfig {
  path: string;
  method?: string;
  signatureHeader?: string;
  timestampHeader?: string; // NEW: e.g., 'X-Timestamp'
  description?: string;
}
```

**Testing:**

- [ ] Send webhook with old timestamp (6 min old), verify rejection
- [ ] Send webhook twice with same timestamp/payload, verify second rejected
- [ ] Send webhook with fresh timestamp, verify acceptance
- [ ] Test Stripe webhook still works
- [ ] Test GitHub webhook (legacy, no timestamp) still works

---

### Phase 5: Compliance Documentation (Week 8)

**Effort:** 1 week | **Risk Reduction:** 5%

#### 5.1 GDPR-005: Incident Response Runbook

**Priority:** P1 | **Effort:** 1 week | **Severity:** High

**Deliverables:**

1. `docs/INCIDENT-RESPONSE.md` - Runbook for breach detection and response
2. `server/services/incident.service.ts` - Incident logging and notification
3. Email templates for breach notification
4. Breach assessment worksheet

**Runbook Outline:**

```markdown
# Incident Response Plan

## 1. Detection

- Failed authentication spike (>100 failures in 5 min)
- Mass data export (>1000 records in 1 hour)
- Unauthorized privilege escalation
- Database access from unknown IP
- Suspicious vector search patterns

## 2. Assessment (within 72 hours)

- [ ] Identify affected data categories
- [ ] Count affected data subjects
- [ ] Determine severity (low/medium/high/critical)
- [ ] Assess root cause
- [ ] Document timeline

## 3. Containment

- [ ] Revoke compromised credentials
- [ ] Block attacker IPs
- [ ] Rotate API keys/secrets
- [ ] Isolate affected systems

## 4. Notification

- [ ] Notify DPO/security team immediately
- [ ] If critical, notify supervisory authority within 72h (Art.33)
- [ ] If high risk to data subjects, notify affected individuals (Art.34)
- [ ] Notify affected tenants (processors duty)

## 5. Remediation

- [ ] Patch vulnerability
- [ ] Restore from clean backup if needed
- [ ] Re-apply deletions (DSAR log)
- [ ] Update security controls

## 6. Documentation

- [ ] Incident report in audit log
- [ ] Lessons learned document
- [ ] Update security measures
```

**Implementation:**

```typescript
// server/services/incident.service.ts
export async function reportBreach(incident: {
  description: string;
  affectedDataSubjects: number;
  dataCategories: string[];
  detectedAt: Date;
  severity: "low" | "medium" | "high" | "critical";
}) {
  // Log incident
  const incidentId = await AppDataSource.query(
    `INSERT INTO incidents (description, affected_subjects, data_categories, detected_at, severity, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      incident.description,
      incident.affectedDataSubjects,
      incident.dataCategories,
      incident.detectedAt,
      incident.severity,
      "open",
    ],
  );

  // Notify security team
  await emailService.send({
    to: config.security.dpoEmail || "security@hay.chat",
    subject: `[URGENT] Data Breach Detected: ${incident.description}`,
    template: "breach-notification",
    variables: { ...incident, incidentId: incidentId[0].id },
  });

  // If critical, prepare Art.33 notification
  if (incident.severity === "critical" && incident.affectedDataSubjects > 100) {
    await this.generateArt33Report(incidentId[0].id);
  }
}
```

---

### Phase 6: Optional Enhancements (Weeks 9-12)

**Effort:** 4 weeks | **Risk Reduction:** 5%

#### 6.1 GDPR-006: Data Residency Controls

**Priority:** P2 | **Effort:** 2 weeks | **Severity:** Medium

**Implementation Summary:**

- Add `REGION` config (`eu`, `us`, `global`)
- Validate DB host resolves to desired region
- Use region-specific OpenAI endpoints (if available)
- Add `region` field to organizations table
- Enforce region affinity in queries

#### 6.2 GDPR-012: Centralized Logging with PII Redaction

**Priority:** P2 | **Effort:** 1 week | **Severity:** Low

**Implementation Summary:**

- Replace `console.error` with Winston logger
- Add PII redaction formatter (mask emails, phones, content)
- Configure production log retention (30 days)
- Add `beforeSend` filter for observability exports

#### 6.3 GDPR-010: Consent Management for Web Chat

**Priority:** P3 | **Effort:** 1 week | **Severity:** Low

**Implementation Summary:**

- Add `consent: 'strict'` mode to widget config
- Delay sessionStorage writes until first message (implied consent)
- Provide sample consent banner code in docs
- Document sessionStorage use as strictly necessary

#### 6.4 GDPR-011: OpenAI Training Opt-Out Verification

**Priority:** P2 | **Effort:** 1 day | **Severity:** Medium

**Implementation Summary:**

- Verify OpenAI Enterprise agreement includes training opt-out
- Add code comment documenting opt-out status
- Add startup validation for training opt-out flag (if needed)
- Document in `SUBPROCESSORS.md`

---

## Testing Strategy

### Unit Tests

- DSAR service methods (export, delete, verify)
- Retention worker logic
- Webhook signature verification with timestamp
- Embedding cascade deletion

### Integration Tests

- End-to-end DSAR flow (request → verify → download)
- Retention cleanup across multiple orgs
- Webhook replay attack prevention
- Cross-tenant isolation (no data leakage)

### Security Tests

- Penetration test DSAR endpoints (auth bypass, rate limiting)
- Test JWT secret validation (reject weak secrets)
- Test incident detection (trigger breach, verify alerts)

---

## Rollout Plan

### Pre-Deployment

- [ ] Legal review of DSAR workflows
- [ ] Privacy policy update with retention periods
- [ ] DPA template for tenants (Art.28 compliance)
- [ ] Customer communication plan

### Deployment

- [ ] Phase 1: Security fixes (JWT, subprocessors docs)
- [ ] Phase 2: DSAR endpoints (beta, limited orgs)
- [ ] Phase 3: Retention policies (opt-in, then default)
- [ ] Phase 4: Security hardening
- [ ] Phase 5: Incident response live

### Post-Deployment

- [ ] Monitor DSAR request volume
- [ ] Review retention cleanup logs
- [ ] Conduct GDPR compliance audit (external)
- [ ] Quarterly security reviews

---

## Metrics & KPIs

**Compliance Metrics:**

- DSAR request processing time (target: <30 days)
- Retention policy coverage (target: 100% of orgs)
- Incident detection latency (target: <1 hour)
- Data deletion completeness (target: 100%)

**Engineering Metrics:**

- DSAR API uptime (target: 99.9%)
- Export generation time (target: <10 min)
- Retention worker execution time (target: <1 hour)

---

## Support & Escalation

**GDPR Questions:** legal@hay.chat
**Security Incidents:** security@hay.chat
**Implementation Support:** engineering@hay.chat
**DPO Contact:** dpo@hay.chat (if appointed)

---

**Last Updated:** 2025-10-08
**Next Review:** 2025-11-08

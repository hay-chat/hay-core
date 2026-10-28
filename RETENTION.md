# Data Retention

This document describes the automatic data retention system in Hay.

## Overview

Hay enforces per-organization data retention policies through a daily cleanup worker. When an organization configures a `retentionDays` value, closed conversations older than that window are automatically anonymized and their linked data (messages, embeddings) is removed.

## Configuration

Retention is configured per-organization via the `settings.retentionDays` field:

```typescript
// Organization.settings
{
  retentionDays: 30; // Anonymize conversations closed more than 30 days ago
  // null or 0 = retention disabled (data kept indefinitely)
}
```

## Daily Cleanup Worker

**Schedule:** `0 3 * * *` (daily at 3:00 AM UTC)
**Job name:** `conversation-retention-anonymize`
**Timeout:** 30 minutes
**Singleton:** Yes (prevents concurrent executions)
**Retry:** Up to 3 times on failure

### What It Does

For each organization with `retentionDays > 0`:

1. **Identifies eligible conversations** matching all criteria:
   - `deleted_at IS NULL` (not already anonymized)
   - `legal_hold = false` (not under legal hold)
   - Status is `closed`, `resolved` or `unresolved`
   - `closed_at` (or `created_at` if never closed) is before the cutoff date

2. **Deletes linked embeddings** via `vectorStoreService.deleteByConversationIds()`
   - Removes embeddings that reference the conversation in their metadata

3. **Deletes all messages** belonging to the conversations

4. **Anonymizes the conversation record** (soft-delete):
   - `deleted_at` set to current timestamp
   - `customer_id` set to NULL
   - `title` set to `"[Anonymized]"`
   - `context`, `metadata`, `document_ids` set to NULL
   - Analytics fields preserved: `status`, `channel`, `agent_id`, `created_at`, `closed_at`

5. **Logs the action** to `audit_logs` with action `retention.cleanup`

### What Is Preserved

Anonymized conversations keep their structural fields for analytics:

- Timestamps (`created_at`, `closed_at`, `updated_at`)
- Status and channel
- Agent assignment (`agent_id`)
- Organization assignment (`organization_id`)

### Billing outcomes and insight issues

Two tables written at close outlive the conversation's messages on purpose:

- `conversation_outcomes`: one billing outcome per close (outcome, billable, reversed, timestamps). It holds no message text; `classification_reason` is a short model explanation, instructed to contain no personal data and passed through the log redaction regexes. It is the billing record, so it is kept.
- `insight_issues`: one QA event per classified close for the Insights engine. `summary`, `snippet`, `paraphrase`, `root_cause` and `area` are PII-redacted (the model is told to replace personal data with `[redacted]`, then the email/phone/card/IP regexes run). Per Roger's D3 decision, redacted snippets may outlive conversation retention.
  - `source = user_feedback` issues (one per staff rating of an AI reply) also keep a redacted `detail` written by the enrichment call; the staff comment is redacted before it is stored, and the reviewer is not recorded. They link to the message and the feedback row with `ON DELETE SET NULL`, so retention deleting the message (which cascades to `message_feedback`) leaves the issue in place. Deleting a feedback row by hand in the dashboard deletes its issue too (the rating was withdrawn).
- `insight_issue_embeddings`: one vector per issue, built only from the redacted issue text (stored in `content`). It cascades with the issue and with the organization.
- `insight_runs`: one cost and timing row per Insights LLM run (model, token counts, estimated USD, duration, success). No conversation, customer or text content; it cascades with the organization and is kept indefinitely for cost tracking.

`conversation_outcomes` and `insight_issues` reference the conversation with `ON DELETE SET NULL` and the organization with `ON DELETE CASCADE`. DSAR: a customer erasure deletes their conversations, which nulls the link; the issues hold no identifiers of the customer, so they are not part of the export.

## Legal Hold

Conversations can be exempted from automatic retention cleanup by enabling legal hold:

```typescript
await dataRetentionService.setLegalHold(conversationId, organizationId, true);
```

When `legal_hold = true`:

- The conversation is **never** anonymized by the daily cleanup worker
- The `legal_hold_set_at` timestamp records when the hold was applied
- Legal hold can be removed later to allow normal retention processing

## Soft-Delete Filtering

Anonymized conversations (`deleted_at IS NOT NULL`) are excluded from:

- Conversation listing and pagination
- Daily stats and analytics counts
- Processing queues (orchestrator, ready-for-processing)
- Agent-scoped and organization-scoped queries

Direct lookups by ID (`findById`, `findByIdAndOrganization`) still return anonymized conversations for administrative access.

## Audit Trail

Every retention cleanup run produces an audit log entry:

```json
{
  "action": "retention.cleanup",
  "organizationId": "org-uuid",
  "status": "success",
  "metadata": {
    "conversationsAnonymized": 5,
    "messagesDeleted": 42,
    "embeddingsDeleted": 12,
    "retentionDays": 30,
    "cutoffDate": "2025-01-15T00:00:00.000Z",
    "conversationIds": ["conv-1", "conv-2", "..."]
  }
}
```

Failed cleanup attempts are also logged with `status: "failure"` and an `errorMessage`.

## Database Fields

### Conversation entity

| Column              | Type                    | Description                                 |
| ------------------- | ----------------------- | ------------------------------------------- |
| `deleted_at`        | TIMESTAMPTZ (nullable)  | When the conversation was anonymized        |
| `legal_hold`        | BOOLEAN (default false) | Exempts conversation from retention cleanup |
| `legal_hold_set_at` | TIMESTAMPTZ (nullable)  | When legal hold was last changed            |

### Indexes

- `idx_conversations_retention_cleanup` - Efficient lookup for the cleanup query
- `idx_conversations_legal_hold` - Fast filtering of legal hold conversations

## Testing

```bash
cd server
npx jest tests/services/data-retention.service.test.ts
```

Test coverage includes:

- 7-day retention window anonymization
- Legal hold preservation (conversations with `legal_hold = true` are never anonymized)
- Embedding deletion alongside conversation anonymization
- PII field clearing (`customer_id`, `title`, `context`, `metadata`, `document_ids`)
- Multi-organization independent processing
- Error isolation (one org failure does not affect others)
- Audit log creation for success and failure cases

## Source Files

- **Service:** `server/services/data-retention.service.ts`
- **Scheduler registration:** `server/services/scheduled-jobs.registry.ts`
- **Conversation entity:** `server/database/entities/conversation.entity.ts`
- **Migration:** `server/database/migrations/1768400000000-AddDataRetentionFields.ts`
- **Tests:** `server/tests/services/data-retention.service.test.ts`

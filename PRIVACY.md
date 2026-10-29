# GDPR Privacy & Data Subject Access Rights (DSAR)

This document describes the implementation of GDPR-compliant Data Subject Access Request (DSAR) features in Hay.

## Overview

Hay provides DSAR capabilities allowing users to exercise their rights under GDPR Article 15 (Right of Access) and Article 17 (Right to Erasure). Article 16 (Right to Rectification) has no self-service endpoint yet: users correct their own profile in the dashboard, and other rectification requests are handled manually.

## API Endpoints

All privacy endpoints are available under `/v1/privacy` and are **public** (no authentication required). Identity verification is performed via email verification codes.

### Base URL

```
http://localhost:3001/v1/privacy
```

## Endpoints

### 1. Request Data Export

**Endpoint:** `privacy.requestExport`
**Type:** Mutation
**Authentication:** None (Public)

Initiates a data export request. Sends a verification email to the provided address.

**Input:**

```typescript
{
  email: string; // Valid email address
}
```

**Response:**

```typescript
{
  success: boolean;
  requestId: string; // UUID of the privacy request
  message: string; // User-friendly message
  expiresAt: Date; // When the verification link expires (24 hours)
}
```

**Example:**

```typescript
const result = await trpc.privacy.requestExport.mutate({
  email: "user@example.com",
});
```

---

### 2. Confirm Data Export

**Endpoint:** `privacy.confirmExport`
**Type:** Mutation
**Authentication:** None (Public)

Confirms a data export request using the verification token from email. Creates a background job to generate the export.

**Input:**

```typescript
{
  token: string; // Verification token from email
}
```

**Response:**

```typescript
{
  success: boolean;
  requestId: string; // UUID of the privacy request
  jobId: string; // UUID of the background job
  message: string; // User-friendly message
}
```

**Example:**

```typescript
const result = await trpc.privacy.confirmExport.mutate({
  token: "abc123...",
});
```

---

### 3. Request Data Deletion

**Endpoint:** `privacy.requestDeletion`
**Type:** Mutation
**Authentication:** None (Public)

Initiates a data deletion request. Sends a verification email to the provided address.

**Input:**

```typescript
{
  email: string; // Valid email address
}
```

**Response:**

```typescript
{
  success: boolean;
  requestId: string; // UUID of the privacy request
  message: string; // User-friendly message
  expiresAt: Date; // When the verification link expires (24 hours)
}
```

**Example:**

```typescript
const result = await trpc.privacy.requestDeletion.mutate({
  email: "user@example.com",
});
```

---

### 4. Confirm Data Deletion

**Endpoint:** `privacy.confirmDeletion`
**Type:** Mutation
**Authentication:** None (Public)

Confirms a data deletion request using the verification token from email. Creates a background job to delete the data.

**Input:**

```typescript
{
  token: string; // Verification token from email
}
```

**Response:**

```typescript
{
  success: boolean;
  requestId: string; // UUID of the privacy request
  jobId: string; // UUID of the background job
  message: string; // User-friendly message
}
```

**Example:**

```typescript
const result = await trpc.privacy.confirmDeletion.mutate({
  token: "abc123...",
});
```

---

### 5. Get Request Status

**Endpoint:** `privacy.getStatus`
**Type:** Query
**Authentication:** None (Public)

Retrieves the current status of a privacy request.

**Input:**

```typescript
{
  requestId: string; // UUID of the privacy request
}
```

**Response:**

```typescript
{
  success: boolean
  id: string
  type: "export" | "deletion" | "rectification"
  status: "pending_verification" | "verified" | "processing" | "completed" | "failed" | "expired" | "cancelled"
  createdAt: Date
  completedAt?: Date
  jobId?: string
  jobStatus?: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled" | "retrying"
  downloadAvailable: boolean  // True if export is ready
  errorMessage?: string
}
```

**Example:**

```typescript
const status = await trpc.privacy.getStatus.query({
  requestId: "550e8400-e29b-41d4-a716-446655440000",
});
```

---

### 6. Download Export

**Endpoint:** `privacy.downloadExport`
**Type:** Query
**Authentication:** None (Public)

Downloads the completed data export using the request ID and download token from the notification email.

**Input:**

```typescript
{
  requestId: string; // UUID of the privacy request
  downloadToken: string; // Download token from email
}
```

**Response:**

```typescript
{
  success: boolean;
  data: object; // Complete user data export (JSON)
  fileName: string; // Suggested filename for download
}
```

**Example:**

```typescript
const download = await trpc.privacy.downloadExport.query({
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  downloadToken: "abc123...",
});
```

---

## Rate Limiting

To prevent abuse, the following rate limits are enforced:

| Limit Type                | Threshold  | Window   | Description         |
| ------------------------- | ---------- | -------- | ------------------- |
| **IP-based**              | 5 requests | 1 hour   | Per IP address      |
| **Email-based**           | 3 requests | 24 hours | Per email address   |
| **Combined (IP + Email)** | 2 requests | 24 hours | Combined identifier |

Rate limits are implemented using Redis with sliding window counters.

**Rate Limit Response:**

```typescript
{
  code: "TOO_MANY_REQUESTS";
  message: "Too many requests. Please try again after [timestamp].";
}
```

---

## Data Export Format

Exports are provided in JSON format and include:

```json
{
  "exportDate": "2025-01-20T10:30:00.000Z",
  "dataSubject": {
    "email": "user@example.com",
    "userId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "personalData": {
    "profile": {
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "lastLoginAt": "2025-01-20T09:00:00.000Z",
      "lastSeenAt": "2025-01-20T10:00:00.000Z",
      "role": "member",
      "status": "available"
    },
    "organization": {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "name": "Acme Corp",
      "role": "member"
    },
    "apiKeys": [
      {
        "id": "...",
        "name": "Production API Key",
        "createdAt": "...",
        "lastUsedAt": "...",
        "expiresAt": null,
        "scopes": [...],
        "isActive": true
      }
    ],
    "auditLogs": [
      {
        "id": "...",
        "action": "user.login",
        "resource": "user",
        "changes": {...},
        "createdAt": "...",
        "ipAddress": "192.168.1.1",
        "status": "success"
      }
    ],
    "documents": [
      {
        "id": "...",
        "title": "Document Title",
        "createdAt": "...",
        "updatedAt": "...",
        "metadata": {...}
      }
    ]
  }
}
```

---

## Data Deletion Strategy

When a deletion request is confirmed, the following actions are taken:

### Account Access

- **Sessions:** All of the user's refresh sessions are revoked, so no device stays signed in. _(Pending: depends on the erasure changes in the current security batch; until they land, sign-in is blocked by the password and email reset below, but existing sessions are not revoked.)_
- **API Keys:** API keys belong to the organization, not to a user, and are **not** deleted with a user account. Organization owners manage them under Settings → API keys; key creation, revocation and deletion are recorded in the audit log.

### Soft Deletion

- **User Account:** `deletedAt` timestamp set, `isActive` set to `false`
- **Email:** Changed to `deleted-{userId}@deleted.local`
- **Name:** First and last names removed
- **Password:** Replaced with a value no password can match

### Anonymization

- **Audit Logs:** `userId` set to `NULL`, IP addresses truncated (last IPv4 octet / IPv6 suffix zeroed), user agents replaced with `"deleted"`, and personal fields inside `changes`/`metadata` redacted. The event itself (action, time, organization) is kept.
- **Created/Updated Records:** User references in documents/content anonymized

### Retention for Compliance

- Audit logs (anonymized or not) are deleted after **90 days** by the `cleanup-old-audit-logs` daily job.
- Backups: production databases run on a managed provider (DigitalOcean) with the provider's automated backups. Hay has no backup rotation of its own, so deleted data can remain in provider backups for the provider's backup retention window. _(To confirm: the configured backup retention period.)_

---

## Security Features

### 1. Email Verification

- Verification tokens are cryptographically secure (32 bytes)
- Tokens are hashed with SHA-256 before storage (they are high-entropy random values, so a slow password hash is not needed)
- Verification links expire after 24 hours

### 2. Download Tokens

- Separate download token generated for export access
- The download link and the export file expire together, 7 days after the export is ready; expired files are deleted by the `cleanup-expired-privacy-exports` daily job. _(Pending: the erasure/export changes in the current security batch may shorten this; confirm the final value before merge.)_

### 3. Audit Trail

All DSAR actions are recorded in the audit log. Audit rows are append-only at the database level: they cannot be edited or deleted, except for the erasure anonymization above and the 90-day retention cleanup. Deleting an organization keeps its audit rows (the organization reference is cleared; the original organization id is retained).

- `privacy.export.request`
- `privacy.export.confirm`
- `privacy.export.download`
- `privacy.deletion.request`
- `privacy.deletion.confirm`
- `privacy.deletion.complete`

### 4. IP & User Agent Tracking

- All requests capture IP address and user agent
- Used for fraud detection and security monitoring

---

## Email Notifications

### Export Request Verification

**Template:** `privacy-export-request`
**Subject:** "Verify Your Data Export Request"
**Sent to:** Requested email address
**Contains:** Verification link (expires in 24 hours)

### Export Ready

**Template:** `privacy-export-ready`
**Subject:** "Your Data Export is Ready"
**Sent to:** Requested email address
**Contains:** Download link with token (expires in 7 days)

### Deletion Request Verification

**Template:** `privacy-deletion-request`
**Subject:** "Verify Your Data Deletion Request"
**Sent to:** Account email address
**Contains:** Verification link (expires in 24 hours), warning about permanence

### Deletion Complete

**Template:** `privacy-deletion-complete`
**Subject:** "Your Data Has Been Deleted"
**Sent to:** Original email address
**Contains:** Confirmation and retention policy details

---

## Background Job Processing

Data exports and deletions are processed asynchronously using the Job Queue system:

1. **Request Created** → Verification email sent
2. **Request Verified** → Job created with status `PENDING`
3. **Job Processing** → Status updated to `PROCESSING`
4. **Job Complete** → Status updated to `COMPLETED`, notification sent
5. **Job Failed** → Status updated to `FAILED`, error stored

Jobs can be monitored via:

- WebSocket updates (published to Redis channel `job:updates`)
- Status endpoint (`privacy.getStatus`)

---

## Testing

### Integration Tests

Run the complete test suite:

```bash
cd server
npm test -- privacy.test.ts
```

Test coverage includes:

- ✅ Export request end-to-end flow
- ✅ Deletion request end-to-end flow
- ✅ Rate limiting enforcement
- ✅ Audit log verification
- ✅ Email verification token validation
- ✅ Download token validation
- ✅ Export data completeness
- ✅ Deletion data anonymization

### Manual Testing

1. **Request Export:**

```bash
curl -X POST http://localhost:3001/v1/privacy/requestExport \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

2. **Check Email** for verification link

3. **Confirm Export:**

```bash
curl -X POST http://localhost:3001/v1/privacy/confirmExport \
  -H "Content-Type: application/json" \
  -d '{"token": "TOKEN_FROM_EMAIL"}'
```

4. **Check Status:**

```bash
curl http://localhost:3001/v1/privacy/getStatus?requestId=REQUEST_ID
```

5. **Download Export** (after completion email):

```bash
curl http://localhost:3001/v1/privacy/downloadExport?requestId=REQUEST_ID&downloadToken=TOKEN
```

---

## Database Schema

### `privacy_requests` Table

| Column                    | Type         | Description                           |
| ------------------------- | ------------ | ------------------------------------- |
| `id`                      | UUID         | Primary key                           |
| `email`                   | VARCHAR(255) | Email address                         |
| `user_id`                 | UUID         | User reference (nullable)             |
| `type`                    | ENUM         | `export`, `deletion`, `rectification` |
| `status`                  | ENUM         | Request status                        |
| `verification_token_hash` | VARCHAR(255) | Hashed verification token             |
| `verification_expires_at` | TIMESTAMPTZ  | Token expiry                          |
| `verified_at`             | TIMESTAMPTZ  | When verified                         |
| `job_id`                  | UUID         | Background job reference              |
| `ip_address`              | VARCHAR(45)  | Request origin IP                     |
| `user_agent`              | VARCHAR(500) | Request user agent                    |
| `completed_at`            | TIMESTAMPTZ  | Completion timestamp                  |
| `metadata`                | JSONB        | Export URLs, tokens, etc.             |
| `error_message`           | TEXT         | Error details if failed               |
| `created_at`              | TIMESTAMPTZ  | Creation timestamp                    |
| `updated_at`              | TIMESTAMPTZ  | Last update timestamp                 |

### Indexes

- `idx_privacy_requests_email` - Fast lookup by email
- `idx_privacy_requests_status` - Filter by status
- `idx_privacy_requests_type` - Filter by request type
- `idx_privacy_requests_created_at` - Chronological sorting
- `idx_privacy_requests_verification_expires` - Expiry cleanup

---

## Sub-processors

Third parties that process visitor data on behalf of Hay.chat customers.

Sub-processors of the hosted Hay.chat service. Self-hosted installs use whichever providers they configure. DPA status is tracked in [gdpr-audit/Subprocessors.csv](gdpr-audit/Subprocessors.csv); entries marked _to confirm_ have not been verified yet.

| Sub-processor                                                     | Purpose                                                                                   | Data                                                                                                                                                                                    | Region                                                                                                                                | When                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI, L.L.C.                                                    | AI chat, embeddings, voice-note transcription, vision on customer photos and PDFs         | Conversation content, customer files the AI reads, knowledge-base content                                                                                                               | US by default; EU (OpenAI EU data residency) for organizations that turn on EU-only AI processing, when the EU endpoint is configured | Every AI reply, knowledge-base indexing, and file/voice-note processing when enabled                                                                                                                                            |
| DigitalOcean, LLC (Gradient AI inference)                         | AI chat inference when the deployment's default model provider is DigitalOcean            | Conversation content                                                                                                                                                                    | _To confirm_                                                                                                                          | Every AI reply when configured as the default provider. EU-only organizations never use it                                                                                                                                      |
| DigitalOcean, LLC (managed PostgreSQL, Redis/Valkey, app hosting) | Hosting of the application, database and cache                                            | All data stored by Hay                                                                                                                                                                  | EU (Amsterdam) for the cache; _to confirm_ for the database and app                                                                   | Always                                                                                                                                                                                                                          |
| S3-compatible object storage (provider _to confirm_)              | Uploaded files, conversation media, export archives                                       | Files customers and users upload, DSAR and organization exports                                                                                                                         | _To confirm_                                                                                                                          | When files are uploaded or exports are generated                                                                                                                                                                                |
| Resend, Inc.                                                      | Transactional email over SMTP (verification, invitations, notifications, DSAR emails)     | Recipient email address and name, email content                                                                                                                                         | _To confirm_                                                                                                                          | Every transactional email                                                                                                                                                                                                       |
| Cloudflare, Inc. (Turnstile)                                      | Bot protection on the webchat widget                                                      | Visitor IP address, browser and device signals collected by the challenge, the Hay.chat API hostname. No message content.                                                               | Global network                                                                                                                        | When a visitor sends their first webchat message and the org has bot protection on (default for new orgs, invisible mode). Strict consent mode still runs it after the first message, as a strictly necessary security measure. |
| Stripe, Inc.                                                      | Subscription billing for Hay.chat organizations                                           | Billing contact, organization name, payment metadata (card data stays with Stripe)                                                                                                      | US / EU                                                                                                                               | Hosted billing only                                                                                                                                                                                                             |
| PostHog, Inc.                                                     | Product analytics and error/session diagnostics in the dashboard (not the webchat widget) | Opaque user id, organization id and name, page paths without query strings, interaction events with element text and attributes masked, session replays with all text and inputs masked | EU (eu.posthog.com)                                                                                                                   | Dashboard sessions, only when `POSTHOG_KEY` is set                                                                                                                                                                              |

Plugins an organization enables (e.g. Shopify, WhatsApp, Zendesk) send data to that platform on the organization's instruction; those platforms are the organization's own processors, not Hay.chat sub-processors.

## Data Retention Policy

| Data Type            | Retention Period        | Notes                                                                               |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| **Conversations**    | Per-org `retentionDays` | Automatically anonymized by daily cleanup worker (see [RETENTION.md](RETENTION.md)) |
| **Embeddings**       | Per-org `retentionDays` | Deleted alongside anonymized conversations                                          |
| **Export Files**     | 7 days                  | Automatically deleted after download link expires                                   |
| **Privacy Requests** | Permanent               | Audit trail for compliance                                                          |
| **Audit Logs**       | 90 days                 | Deleted daily by the `cleanup-old-audit-logs` job; kept after organization deletion |
| **Database Backups** | Provider's retention    | Managed-database automated backups; no Hay-side rotation (period _to confirm_)      |

---

## Compliance Notes

This implementation complies with:

- ✅ GDPR Article 15 (Right of Access)
- ✅ GDPR Article 17 (Right to Erasure / "Right to be Forgotten")
- ✅ GDPR Article 12 (Transparent Information, Free of Charge)
- ✅ GDPR Article 5 (Data Minimization & Storage Limitation)
- ✅ 30-day response time requirement (typically < 24 hours)

---

## Troubleshooting

### Export Not Ready

- Check job status via `getStatus` endpoint
- Jobs typically complete in < 5 minutes
- Check server logs for errors: `[Privacy] Export job failed`

### Verification Link Expired

- Request a new export/deletion
- Verification links are valid for 24 hours

### Rate Limit Exceeded

- Wait for the time specified in the error message
- Rate limits reset automatically
- **Development Only:** Reset rate limits manually:
  ```bash
  cd server
  ./scripts/reset-rate-limits.sh
  ```

### Download Token Invalid

- Download links expire after 7 days (see Download Tokens above)
- Request new export if expired

---

## Future Enhancements

- [ ] Data rectification endpoint (GDPR Article 16)
- [ ] Data portability in multiple formats (CSV, XML)
- [ ] Documented backup retention period and restore-time re-erasure procedure
- [ ] Self-service request cancellation
- [ ] Admin dashboard for DSAR monitoring
- [ ] Multi-language email templates

---

## Support

For questions or issues with DSAR requests:

- **Email:** support@hay.chat
- **Documentation:** https://docs.hay.chat/privacy
- **Security Issues:** security@hay.chat

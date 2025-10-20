# GDPR Privacy & Data Subject Access Rights (DSAR)

This document describes the implementation of GDPR-compliant Data Subject Access Request (DSAR) features in Hay.

## Overview

Hay provides comprehensive DSAR capabilities allowing users to exercise their rights under GDPR Article 15 (Right of Access), Article 17 (Right to Erasure), and Article 16 (Right to Rectification).

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
  email: string  // Valid email address
}
```

**Response:**
```typescript
{
  success: boolean
  requestId: string        // UUID of the privacy request
  message: string          // User-friendly message
  expiresAt: Date          // When the verification link expires (24 hours)
}
```

**Example:**
```typescript
const result = await trpc.privacy.requestExport.mutate({
  email: "user@example.com"
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
  token: string  // Verification token from email
}
```

**Response:**
```typescript
{
  success: boolean
  requestId: string  // UUID of the privacy request
  jobId: string      // UUID of the background job
  message: string    // User-friendly message
}
```

**Example:**
```typescript
const result = await trpc.privacy.confirmExport.mutate({
  token: "abc123..."
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
  email: string  // Valid email address
}
```

**Response:**
```typescript
{
  success: boolean
  requestId: string  // UUID of the privacy request
  message: string    // User-friendly message
  expiresAt: Date    // When the verification link expires (24 hours)
}
```

**Example:**
```typescript
const result = await trpc.privacy.requestDeletion.mutate({
  email: "user@example.com"
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
  token: string  // Verification token from email
}
```

**Response:**
```typescript
{
  success: boolean
  requestId: string  // UUID of the privacy request
  jobId: string      // UUID of the background job
  message: string    // User-friendly message
}
```

**Example:**
```typescript
const result = await trpc.privacy.confirmDeletion.mutate({
  token: "abc123..."
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
  requestId: string  // UUID of the privacy request
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
  requestId: "550e8400-e29b-41d4-a716-446655440000"
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
  requestId: string      // UUID of the privacy request
  downloadToken: string  // Download token from email
}
```

**Response:**
```typescript
{
  success: boolean
  data: object      // Complete user data export (JSON)
  fileName: string  // Suggested filename for download
}
```

**Example:**
```typescript
const download = await trpc.privacy.downloadExport.query({
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  downloadToken: "abc123..."
});
```

---

## Rate Limiting

To prevent abuse, the following rate limits are enforced:

| Limit Type | Threshold | Window | Description |
|------------|-----------|--------|-------------|
| **IP-based** | 5 requests | 1 hour | Per IP address |
| **Email-based** | 3 requests | 24 hours | Per email address |
| **Combined (IP + Email)** | 2 requests | 24 hours | Combined identifier |

Rate limits are implemented using Redis with sliding window counters.

**Rate Limit Response:**
```typescript
{
  code: "TOO_MANY_REQUESTS"
  message: "Too many requests. Please try again after [timestamp]."
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

### Hard Deletion
- **API Keys:** Permanently deleted
- **Sessions:** Permanently revoked

### Soft Deletion
- **User Account:** `deletedAt` timestamp set, `isActive` set to `false`
- **Email:** Changed to `deleted-{userId}@deleted.local`
- **Name:** First and last names removed
- **Password:** Replaced with placeholder

### Anonymization
- **Audit Logs:** `userId` replaced with `"deleted-user"`, IP addresses and user agents anonymized
- **Created/Updated Records:** User references in documents/content anonymized

### Retention for Compliance
- Anonymized audit logs retained for 90 days (legal requirement)
- Backup copies deleted as part of regular rotation (within 90 days)

---

## Security Features

### 1. Email Verification
- Verification tokens are cryptographically secure (32 bytes)
- Tokens are hashed using Argon2 before storage
- Verification links expire after 24 hours

### 2. Download Tokens
- Separate download token generated for export access
- Download tokens expire after 4 hours
- Export files expire after 7 days

### 3. Audit Trail
All DSAR actions are logged immutably in the audit log:
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

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `email` | VARCHAR(255) | Email address |
| `user_id` | UUID | User reference (nullable) |
| `type` | ENUM | `export`, `deletion`, `rectification` |
| `status` | ENUM | Request status |
| `verification_token_hash` | VARCHAR(255) | Hashed verification token |
| `verification_expires_at` | TIMESTAMPTZ | Token expiry |
| `verified_at` | TIMESTAMPTZ | When verified |
| `job_id` | UUID | Background job reference |
| `ip_address` | VARCHAR(45) | Request origin IP |
| `user_agent` | VARCHAR(500) | Request user agent |
| `completed_at` | TIMESTAMPTZ | Completion timestamp |
| `metadata` | JSONB | Export URLs, tokens, etc. |
| `error_message` | TEXT | Error details if failed |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Indexes
- `idx_privacy_requests_email` - Fast lookup by email
- `idx_privacy_requests_status` - Filter by status
- `idx_privacy_requests_type` - Filter by request type
- `idx_privacy_requests_created_at` - Chronological sorting
- `idx_privacy_requests_verification_expires` - Expiry cleanup

---

## Data Retention Policy

| Data Type | Retention Period | Notes |
|-----------|------------------|-------|
| **Export Files** | 7 days | Automatically deleted after download link expires |
| **Privacy Requests** | Permanent | Audit trail for compliance |
| **Anonymized Audit Logs** | 90 days | Legal requirement for fraud prevention |
| **Deleted User Backups** | 90 days | Removed during regular backup rotation |

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
- Tokens are single-use (planned for future)
- Download links expire after 7 days
- Request new export if expired

---

## Future Enhancements

- [ ] Data rectification endpoint (GDPR Article 16)
- [ ] Data portability in multiple formats (CSV, XML)
- [ ] Automated anonymization of old backups
- [ ] Self-service request cancellation
- [ ] Admin dashboard for DSAR monitoring
- [ ] Multi-language email templates

---

## Support

For questions or issues with DSAR requests:
- **Email:** support@hay.chat
- **Documentation:** https://docs.hay.chat/privacy
- **Security Issues:** security@hay.chat

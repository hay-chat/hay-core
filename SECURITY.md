# Security Policy

## JWT Secret Requirements

Hay requires cryptographically strong JWT secrets for all environments. The server **will not start** if these requirements are not met.

### Requirements

| Variable             | Required | Minimum Length |
| -------------------- | -------- | -------------- |
| `JWT_SECRET`         | Yes      | 32 characters  |
| `JWT_REFRESH_SECRET` | Yes      | 32 characters  |

### Generating Secrets

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run this command twice -- once for `JWT_SECRET` and once for `JWT_REFRESH_SECRET`. Add the generated values to your `.env` file.

### What Gets Validated

At startup, the server checks that each JWT secret:

1. Is present (not empty)
2. Is not a known insecure default (e.g., `"secret"`, `"changeme"`, placeholder values from `.env.example`)
3. Is at least 32 characters long

Validation runs in **all environments** except `test`. There are no default fallback values.

### Rejected Values

The following values are explicitly rejected as known insecure defaults:

- `default-secret-change-in-production`
- `default-refresh-secret-change-in-production`
- `your-secret-key-change-in-production`
- `your-refresh-secret-change-in-production`
- `secret`
- `changeme`

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly by emailing the maintainers directly. Do not open a public issue.

## Webhook Replay Protection

Inbound webhooks signed with Standard Webhooks / Svix signatures (e.g. Resend email events, see `server/lib/svix-signature.ts`) are checked as follows:

- **Signature**: HMAC-SHA256 over `id.timestamp.body` with the provider secret; requests without a valid signature are rejected.
- **Timestamp tolerance**: the provider timestamp must be within **5 minutes** of server time.
- **Message id deduplication**: the provider message id is recorded in **Redis** for the tolerance window and a reused id is rejected. _(Pending: added by the webhook replay change in the current security batch; until it lands only the signature and timestamp are checked.)_

Third-party webhooks received by plugins are verified by each plugin against its provider's own scheme.

## Audit Log

Security-relevant actions (sign-in and sign-out, API keys, members and roles, plugin configuration and credentials, exports, deletions, DSAR requests) are written to the `audit_logs` table.

- Rows are append-only: a database trigger rejects updates and deletes, except clearing a deleted user's or organization's reference, GDPR erasure anonymization, and the retention job.
- Rows are kept **90 days**, also after the organization is deleted (attributable through `original_organization_id`).
- Failed sign-ins for unknown emails store a keyed hash of the email, never the address.

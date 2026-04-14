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

Where Hay receives third-party webhooks (e.g. email and billing providers), inbound webhook requests must be protected against replay attacks.

- **Timestamp tolerance**: Requests must include a provider timestamp and it must be within **5 minutes** of server time.
- **Nonce deduplication**: Requests must include a provider nonce/request id; Hay records that nonce in **Redis** with a 5-minute TTL and rejects any subsequent reuse.
- **Logging**: Missing headers or rejected requests are logged (for tracking legacy senders and investigating abuse).

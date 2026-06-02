# Email Plugin

Send emails through Hay's platform email service to a configured recipient list.

## Overview

The Email plugin gives the AI a `send-email` tool that delivers messages through
the platform's email service. Emails go to the recipients configured in plugin
settings, using the platform's default sender address.

## Configuration

### Recipients

Comma-separated list of email addresses that will receive emails sent by this plugin.

**Example**: `user1@example.com, user2@example.com, alerts@company.com`

Addresses are validated in the UI and at runtime. If no recipients are set, the
plugin stays enabled but `send-email` is unavailable until you configure them.

## Available Tools

### `healthcheck`

Returns the plugin's status and the configured recipient list. No parameters.

### `send-email`

Send an email to all configured recipients.

**Parameters**:

- `subject` (string, required): Email subject line
- `body` (string, required): Email body content (plain text)

**Response**:

```json
{
  "success": true,
  "message": "Email sent to 2 recipient(s)",
  "messageId": "abc123...",
  "recipients": ["user1@example.com", "user2@example.com"],
  "subject": "New User Signup Alert"
}
```

## How it works

- Declares the `email` capability in `package.json` → `hay-plugin`.
- At runtime the worker receives `HAY_API_URL` and `HAY_API_TOKEN` from the
  plugin runner. The `send-email` tool POSTs to the platform's
  `/v1/plugin-api/send-email` endpoint via `src/plugin-api.ts` (`PluginApiClient`).
- The platform sends through its configured SMTP service using the default
  sender (`SMTP_FROM_EMAIL` / `SMTP_FROM_NAME`). SMTP must be configured and
  enabled for sending to work.

## Plugin metadata

- **Category**: `tool`
- **Capabilities**: `mcp`, `config`, `email`

## Development

```bash
cd plugins/core/email
npm install
npm run build
```

## Limitations / TODO

- Plain-text body only (HTML supported by the API but not exposed as a tool param yet).
- No attachments, templates, CC/BCC, or per-call recipient override yet.

## License

MIT

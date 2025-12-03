# Email Plugin

Send emails using the platform's SMTP service with configurable recipient lists.

## Overview

The Email plugin provides a simple way for the AI to send emails through Hay's email service. Emails are sent to configured recipients using the platform's default sender address.

## Features

- **Simple Configuration**: Just add comma-separated email addresses
- **Platform Integration**: Uses Hay's configured SMTP service
- **Plain Text Emails**: Send subject and body as plain text
- **Multiple Recipients**: Support for comma-separated recipient lists
- **Validation**: Email addresses validated both in UI and at runtime

## Configuration

### Recipients

Comma-separated list of email addresses that will receive emails sent by this plugin.

**Example**: `user1@example.com, user2@example.com, alerts@company.com`

**Validation**: Must be valid email addresses (format: name@domain.tld)

## Available Tools

### send-email

Send an email to all configured recipients.

**Parameters**:
- `subject` (string, required): Email subject line
- `body` (string, required): Email body content (plain text)

**Example Usage**:

```
AI: I'll send an email notification about the new signup.

Tool call: send-email
{
  "subject": "New User Signup Alert",
  "body": "A new user just signed up: john@example.com\n\nThis is an automated notification from your Hay assistant."
}
```

**Response**:
```json
{
  "success": true,
  "message": "Email sent successfully to 2 recipient(s): user1@example.com, user2@example.com",
  "messageId": "abc123...",
  "recipients": ["user1@example.com", "user2@example.com"]
}
```

## Technical Details

### Email Service

- Uses platform's configured SMTP service
- From address: Platform default (configured via `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME`)
- Emails are queued and retried on failure (handled by platform)
- SMTP must be configured for email sending to work

### Plugin Type

- **Type**: `mcp-connector`
- **Category**: `utility`
- **Permissions**: `api: ["email"]` (declares use of Email API)

## Development

### Installation

```bash
cd plugins/core/email
npm install
```

### Testing

```bash
# Test the MCP server directly
npm run inspect

# Or run the server
npm start
```

### Environment Variables

The plugin requires these environment variables (automatically provided by the platform):

- `EMAIL_RECIPIENTS`: Comma-separated list of recipient email addresses
- `HAY_ORGANIZATION_ID`: Organization ID for logging/auditing
- `HAY_PLUGIN_ID`: Plugin identifier

## Architecture Notes

### Current Implementation (v1.0.0)

The current implementation uses **direct service imports** to access the email service. This is a temporary solution.

### Future: Plugin API Integration

This plugin is designed to be migrated to the **Plugin API pattern** once implemented:

```typescript
// Future implementation will use PluginContext
export function init(context: PluginContext) {
  // context.email provides controlled email API access
  const result = await context.email.send({
    subject: "...",
    text: "..."
  });
}
```

**Benefits of Plugin API**:
- Controlled access to platform capabilities
- Rate limiting per plugin
- Email quota tracking
- Better security and isolation
- Consistent API across all plugins

**See**: `/server/types/plugin-api.types.ts` for the Plugin API design

## Limitations

- **Plain Text Only**: HTML emails not currently supported (TODO)
- **No Attachments**: Cannot send file attachments (TODO)
- **No Template Support**: No email template rendering (TODO)
- **Fixed Recipients**: Recipients must be configured in plugin settings (cannot override per-call)

## Troubleshooting

### "No recipients configured"

Make sure you've added at least one email address in the plugin settings.

### "Failed to send email"

Check that:
1. SMTP is configured in the platform settings
2. SMTP service is enabled (`SMTP.enabled = true` in config)
3. Recipient email addresses are valid
4. Platform has network access to SMTP server

### Email not received

- Check spam/junk folders
- Verify SMTP configuration is correct
- Check platform logs for email sending errors
- Ensure SMTP service is not in "disabled" mode (would only log, not send)

## TODO: Future Enhancements

- [ ] **Plugin API Integration**: Migrate to use `PluginContext.email` API
- [ ] **HTML Support**: Add HTML email body support
- [ ] **Templates**: Support email templates with variable substitution
- [ ] **Attachments**: Add file attachment support
- [ ] **CC/BCC**: Support CC and BCC recipients
- [ ] **Per-call Recipients**: Allow overriding recipients in tool call
- [ ] **Rate Limiting**: Add per-plugin email sending rate limits
- [ ] **Quota Tracking**: Track email sends per organization
- [ ] **Send History**: Log all emails sent by this plugin
- [ ] **Retry Configuration**: Configurable retry logic
- [ ] **Custom From Address**: Allow plugins to specify sender (with validation)

## License

MIT

# Email Inbox Channel Plugin

Use the store's existing support mailbox as a Hay channel. Shoppers keep
writing to `support@yourstore.com`; the merchant forwards that mailbox to a
per-workspace Hay address; the AI (or a human in the dashboard) replies by
email, threaded like a normal conversation.

## How it works

1. **Ingest alias.** Every org gets a deterministic address on Hay's inbound
   domain: `in-<10 hex of sha256(orgId)>@EMAIL_INBOUND_DOMAIN`. The settings
   page shows it with copy-paste forwarding instructions for Gmail / Google
   Workspace and Outlook / Microsoft 365. Google's forwarding-confirmation
   email is captured and its code shown on the page.
2. **Receiving.** Resend receives the forwarded mail and posts one shared
   `email.received` webhook to `/v1/plugins/hay-channel-email/webhook`. Core
   verifies the svix signature (`RESEND_WEBHOOK_SECRET`) and routes the event
   to the org whose routing key matches the envelope recipient (`data.to[]`,
   normalised: lowercase, display name and `+tag` removed). Each org registers
   one key: its alias. The support address is never a routing key — it is
   unverified config, and routing on it would let one org claim another's
   mail.
3. **Inbound.** The worker fetches the full email from Resend, classifies it
   (echo of our own mail, Gmail confirmation, bounce, auto-reply, list mail,
   customer), strips quoted history and signatures, uploads real attachments
   and calls `messages.receive` with:
   - `conversationId` when a recipient carries the Reply-To token
     `<alias-local>+c<conversationId>@<inbound domain>`;
   - `externalConversationId` = the thread root (first `References` id, else
     `In-Reply-To`, else the message's own `Message-ID`);
   - `title` = subject, `metadata.mid` = Message-ID for dedupe;
   - `holdForHuman` when DMARC failed or the shopper is answering a message a
     human sent from the store's own mailbox (the AI would otherwise keep
     replying) — the conversation lands in _Needs attention_.
4. **Outbound.** Core's ChannelDeliveryService POSTs bot and human-agent
   messages to `/deliver`. The worker replies through the platform relay
   (`/v1/plugin-api/send-email`) as `"<Sender name>" <support@<SMTP_FROM_EMAIL
domain>>` with `In-Reply-To` (shopper's last message), `References` (thread
   root), `Reply-To` token, `X-Hay-Conversation` (echo detection), our own
   `Message-ID` (`<hay-<messageId>@domain>`), optional BCC to the support
   address and `retry:false` so a refused send is reported as failed instead
   of silently retried later.

## Host configuration

| Env                     | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `RESEND_API_KEY`        | Fetch received emails and attachments                                  |
| `RESEND_WEBHOOK_SECRET` | svix signing secret of the `email.received` webhook (verified by core) |
| `EMAIL_INBOUND_DOMAIN`  | Receiving domain whose MX points at Resend, e.g. `inbound.hay.chat`    |
| `SMTP_FROM_EMAIL`       | Platform sender; its domain is the From domain of replies              |

Resend setup (once per host): add `EMAIL_INBOUND_DOMAIN` as a receiving domain
(MX record, never on the root domain), create a webhook for `email.received`
pointing at `https://<api>/v1/plugins/hay-channel-email/webhook`, copy its
signing secret into `RESEND_WEBHOOK_SECRET`.

## Plugin configuration

- **Your support address**: what shoppers write to. Needed for the channel
  (the settings page asks for it); used to recognise the merchant's own
  out-of-band replies, as the BCC archive target and as the default team
  notification address. Optional in the schema so a workspace can use only
  the `send-email` action.
- **Sender name**: display name on replies (defaults to the workspace name).
- **Keep a copy in my inbox**: BCC the support address on every reply.
- **Team notification addresses**: comma-separated recipients of the
  `send-email` action. Defaults to the support address.

## Agent action: `send-email`

The plugin registers one MCP tool (local server `email-mcp`, capability
`mcp`). Playbooks reference it as `hay-channel-email:send-email`. It emails
the store's team — the notification addresses, else the support address —
with `subject` + `body` from the agent, through the same relay and sender
as channel replies (platform default sender when the inbound env is
missing). Recipients come from config only; the agent cannot choose an
address. If the support mailbox forwards the notification back to Hay, the
From address marks it as an echo and it is dropped. A refused send fails the
tool call. This action replaced the former standalone "Email" plugin
(`hay-plugin-email`); migration `MergeEmailPluginIntoEmailInbox1785300000000`
moved existing installs here.

## Limitations (phase 1)

- Replies come from `support@<platform domain>`; sending from the merchant's
  own domain (Resend domain verification) is phase 2.
- Only auto-forwarding is supported; reading a Gmail / Microsoft 365 mailbox
  directly is a later phase.
- Bounces, auto-replies and list mail are logged and dropped, not stored.
- HTML bodies are reduced to text; the original HTML is not kept.

## Development

```bash
cd plugins/core/email-channel
npm install
npm run build      # UI bundle (dist/ui.js) + worker (dist/index.js)
npm test           # vitest
npm run typecheck
```

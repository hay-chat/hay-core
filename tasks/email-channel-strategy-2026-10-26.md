# Inbound email as a channel — strategy (exploration, 2026-10-26)

Status: exploration only, no code. Companion to `tasks/prospect-faq-answers-2026-10-26.md` §12 ("No email channel").

## 1. Where we are

- Outbound only. `server/services/email.service.ts` = nodemailer SMTP pool (Resend is the relay in prod), From
  `noreply@updates.hay.chat`. In-memory retry queue. `EmailOptions` already supports `from`, `replyTo`, `headers`,
  `attachments` (`server/types/email.types.ts:21-29`) but the plugin HTTP endpoint `/v1/plugin-api/send-email`
  only forwards to/subject/text/html/cc/bcc (`server/routes/v1/plugin-api/index.ts:97-104`).
- `plugins/core/email` is a *tool* ("send-email to fixed recipients"), not a channel. Keep it; the channel is a new plugin.
- Channel infrastructure we can reuse as-is (proven by Chatwoot + WhatsApp):
  - plugin `category: "channel"`, `register.route("POST", "/deliver")` called by `channel-delivery.service.ts`
    for Bot and HumanAgent messages (so dashboard replies go out by email with zero extra work);
  - `messages.receive` (plugin-api/trpc.ts:99) upserts the customer by externalId/email, picks the agent for the
    channel, dedupes on `metadata.mid`, accepts `attachments` and `externalConversationId`;
  - `register.webhookRouting` + `webhooks.setRoutingKeys` fan a single shared webhook URL out to orgs by a key
    extracted from the payload (WhatsApp uses phone_number_id);
  - `media.upload` for attachments, `conversations.updateStatusByExternalId`.
- Two things in core do NOT fit email yet (see §5): signature format is hard-coded to `sha256-hmac`
  (`packages/plugin-sdk/sdk/register.ts:233`), and `messages.receive` always threads by "active conversation for
  customer+channel" (`conversation.repository.ts:422`), which is wrong for email (one customer, many threads).

## 2. How a merchant's support@ reaches us — three options

| | A. Forwarding (recommended first) | B. MX on a dedicated subdomain | C. Mailbox API (Gmail / M365) |
|---|---|---|---|
| Merchant does | Adds an auto-forward rule in Gmail/Workspace/M365/Zoho from `support@acme.com` to `acme-<id>@inbound.hay.chat` | Adds one MX record on `help.acme.com` (never the root) pointing at Resend | OAuth-connects the mailbox |
| Keeps existing inbox | Yes, untouched (copy stays in their inbox) | New address; nothing to migrate | Yes |
| Setup time | 5 min, no DNS | 10 min + DNS propagation | 2 min, but see cost |
| Replies from | Phase 1: `"Acme Support" <support@mail.hay.chat>`, Reply-To token address. Phase 2: `support@acme.com` after domain verification | `support@help.acme.com` (same DKIM setup) | Their own mailbox; Sent folder gets a copy |
| Gotchas | Gmail sends a forwarding-confirmation email with a code → we must capture it and show it in the setup wizard (Help Scout does exactly this). SPF fails on forwarded mail (expected; treat `authentication` as a signal, not a gate). Loop risk when we reply to support@ which forwards back → drop mail carrying our own `X-Hay-Conversation` header | Merchant must not put MX on root (Resend routes *all* mail for the name). Routing key is the domain, not an address | Google restricted scopes → CASA security assessment (~$540+/yr via self-serve labs, 4–8 weeks, re-done yearly; 100-user cap until verified). Microsoft shared mailboxes need *application* `Mail.Read` + admin consent; subscriptions expire ≈3 days and must be renewed. Or buy pre-verified access (Nylas/Unipile) = new dependency + per-mailbox fee |

What the category does: Help Scout, Gorgias, Front and Zendesk all default to A, offer B-style custom domains for
sending, and treat C as a premium "connect Gmail/Outlook" option. We should do the same order.

## 3. Provider: stay on Resend

Resend ships receiving (`email.received` webhook, Svix-signed). Facts checked today:
- Receive at `*@<id>.resend.app` (instant, for dev) or a verified custom domain/subdomain via MX. Our inbound domain
  would be `inbound.hay.chat`; any local part works, so routing is `<org-slug-or-id>@inbound.hay.chat`.
- Webhook payload is metadata only (`email_id`, from, to[], cc, subject, `message_id`, attachment names). Body,
  `headers` object, `text`/`html`, `received_for` (original recipient from `Received … for` — this is how we learn
  the merchant's real address on forwarded mail), `authentication` {spf,dkim,dmarc} and `raw.download_url` come from
  `GET /emails/receiving/:id`. Attachments: separate list endpoint, signed URLs valid 1 h.
- Must ack the webhook < 15 s → verify, enqueue, fetch in a job (we already have BullMQ/Redis queues).
- Every received email counts as 1 against the Resend quota. 30-day retention of stored mail. Receiving was marked
  "private beta" on one API page — confirm GA status with Resend before committing.
- Threading: Resend's own guide sets `In-Reply-To`/`References` headers on `emails.send`. UNVERIFIED: whether the
  `headers` object exposes `In-Reply-To`/`References` on inbound (docs only show 3 example headers). Fallback is
  parsing `raw` with `mailparser`, which also gives us `Auto-Submitted`, `List-Id`, etc.
- Custom sending domains: Resend "multi-tenant Option A" — add the merchant's domain to *our* account via
  `domains.create`, show them DKIM + SPF (return-path subdomain) records, poll/`domain.verified` webhook. Cons:
  shared reputation, domain count limit (add-on), aggregate rate limit. Option B (merchant's own Resend key) is
  too much friction for Shopify merchants.
Alternatives considered: Postmark (cleanest inbound JSON, but a second vendor), Mailgun Routes (flexible routing, worse
threading data), SendGrid Inbound Parse (no webhook signing, domain-level routing only), Cloudflare Email Routing
(free forwarder, no API body). None beats staying on the vendor we already pay.

## 4. Threading and conversation model (the real design work)

Email differs from chat: one customer has many concurrent threads, and replies arrive days later.
Match an inbound message to a conversation in this order:
1. **Token in Reply-To**: we send with `Reply-To: support+c_<conversationId>@inbound.hay.chat` (or
   `<slug>+c_…@inbound.hay.chat`). Survives every client, forwarders and "reply all". Zendesk/Help Scout rely on an
   equivalent token.
2. **Headers**: `In-Reply-To` / `References` ∩ our stored outbound Message-IDs (`messages.provider_message_id`).
3. **Heuristic**: same customer email + normalised subject (strip Re:/Fwd:/AW:) + last activity < 14 days.
4. Else new conversation; `title` = subject (today `title` is "" for plugin channels).
Outbound: set `In-Reply-To` = last inbound `message_id`, `References` = chain, subject `Re: <original>`,
`Auto-Submitted: auto-replied` on AI replies (RFC 3834, stops other bots looping with us), `X-Hay-Conversation` for
echo detection. Store our outgoing Message-ID; verify in the spike whether Resend honours a caller-supplied
`Message-ID` header or we must store Resend's.
Inbound body: strip quoted history and signatures (`email-reply-parser` or `talon`-style regex set), HTML→text for
the orchestrator, keep original HTML + attachments for the dashboard to render.
Don't run the orchestrator on: bounces (mailer-daemon, `Return-Path: <>`), `Auto-Submitted != no`,
`Precedence: bulk/list`, `List-Id`, our own echoes, and (policy call) `dmarc: fail` from the merchant's own domain.
Store them as system/customer messages flagged `metadata.emailKind`, surface in "Needs attention" instead.
Lifecycle: no "end of chat" signal → auto-resolve after N idle days (setting, default 7); a new email on a resolved
thread reopens it (existing `conversation.entity.ts:912-933` behaviour already does this). Resolution counting =
billing: email threads will hit the same "abandoned counts as resolved" problem flagged in the FAQ sheet item 1.


### 4a. Why forwarding alone keeps threads (Roger's question, 2026-10-26)

Server-side auto-forward rules (Gmail/Workspace/M365) re-send the original message with its `Message-ID`,
`In-Reply-To`, `References`, `From` and subject intact; only `Received` and the envelope sender change. So:
1. Shopper → support@acme.com → forwarded → us. New `Message-ID <abc@shopper>` unknown → new conversation, store id.
2. We reply straight to the shopper: `In-Reply-To <abc@shopper>`, `References` chain, our own `Message-ID
   <hay-<conv>-<n>@mail.hay.chat>` stored on the message row, `Reply-To: support@acme.com` (or token address).
3. Shopper replies → support@acme.com → forwarded → us with `In-Reply-To <hay-…>` → lookup on
   `messages.provider_message_id` → same conversation. Fallbacks: Reply-To token, then subject+sender heuristic.
Our `messages` table is the mailbox of record; Gmail is a tee. Same model as Help Scout / Gorgias / Front forwarding mode.

**Blind spot:** a staff member replying from inside Gmail never passes through us → AI may keep answering.
Mitigations without mailbox access: (a) dashboard is the reply surface; BCC support@acme.com on our outbound so
their Gmail holds the full archive (echo comes back via forwarding, dropped on `X-Hay-Conversation`);
(b) detect out-of-band replies: a shopper email whose `References` contains an id we never issued, on the merchant's
domain → flip to human-took-over + Needs attention.
**Mailbox connector (Gmail API / MS Graph) is only needed** to ingest staff replies made in Gmail/Outlook and to
mirror ours into their Sent folder. Phase 2/3, not a prerequisite for threading.

## 5. Core changes needed (small, benefit all channels)

1. `register.webhookRouting.signature` new format `"svix"` (HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`,
   base64 secret `whsec_…`, header `svix-signature` = `v1,<b64>`), env `RESEND_WEBHOOK_SECRET`.
2. `routeKeyPath` needs a transform (`"local-part"` / `"domain"` of `data.to[]`), or the plugin registers the full
   inbound address as the key. Forwarding alone works with exact-match keys; MX-subdomain needs the domain transform.
3. `messages.receive`: when `externalConversationId` is supplied, look up `findByExternalConversationId` *before*
   falling back to active-by-customer. Today it only seeds metadata (plugin-api/trpc.ts:217-250).
4. `/v1/plugin-api/send-email` (or a new `email.send` tRPC capability): pass through `from`, `replyTo`, `headers`,
   `attachments`, return the Message-ID, and stop reporting failures as success (FAQ item 6,
   `plugin-api.service.ts:151-171`). Decide SMTP (nodemailer, already wired, supports headers + `messageId`) vs Resend
   SDK (needed anyway for domains API, received-email API, bounce/complaint webhooks). Recommendation: add the Resend
   SDK for receiving + domains, keep nodemailer SMTP for sending in phase 1, move sending to the SDK in phase 2 when
   bounce webhooks → `messages.provider_status` land.
5. `conversation.title` set from subject; dashboard renders `metadata.email.{from,to,subject,html}`.

## 6. Phased plan

- **Phase 0 — spike (1–2 days, no product code):** enable receiving on `inbound.hay.chat` in our Resend account; send
  a Gmail-forwarded mail and dump the `headers` object + raw; confirm In-Reply-To/References availability, 15 s ack,
  attachment URLs, quota accounting, GA vs beta; test whether a caller-supplied Message-ID survives via SMTP and via
  API; run the Gmail forwarding-confirmation flow once by hand. Output: a 1-page findings note + go/no-go.
- **Phase 1 — MVP, forwarding only (≈ 1 sprint):** new plugin `plugins/core/email-channel` (`hay-channel-email`,
  channel `email`): inbound shared webhook → enqueue → fetch → classify → thread → `messages.receive` with
  `externalConversationId` + attachments; `/deliver` → platform send with From `"<Store>" <support@mail.hay.chat>`,
  Reply-To token, threading headers; `/escalate` no-op. Core items 1,3,4,5. Dashboard: setup wizard (choose address →
  copy forwarding address → we show Gmail's confirmation code when it arrives → send test), email header strip on the
  conversation view, i18n en + pt-BR. Tests: Jest on threading/classification/reply-parser; Playwright on the wizard.
  Docs: `docs/user-guide/integrations/email.md`; website: integrations page + compare pages gain "Email" honestly.
- **Phase 2 — their domain (≈ 1 sprint):** Resend domains API (Option A) card with DNS records + status; From
  `support@acme.com`; MX-subdomain receiving (core item 2); bounce/complaint webhooks → `provider_status`; idle
  auto-resolve setting; CC handling (keep CCs on replies).
- **Phase 3 — mailbox connectors (only on demand):** Gmail (watch + Pub/Sub, CASA) and Microsoft Graph (application
  `Mail.Read`/`Mail.Send`, subscription renewals). Budget the CASA fee and 4–8 weeks before promising it.

## 7. Decisions parked (recommended default in bold)

1. Inbound provider: **Resend** vs Postmark. Revisit only if the spike shows headers are missing *and* raw parsing is painful.
2. First setup path: **forwarding** vs custom-domain MX. Forwarding needs no DNS and matches Help Scout/Gorgias.
3. Phase-1 From address: **`"<Store> Support" <support@mail.hay.chat>` with Reply-To token** vs waiting for domain
   verification. Ship first, upgrade in phase 2.
4. Plugin shape: **new `email-channel` plugin**, leave `plugins/core/email` (tool) alone, or fold the tool in later.
5. Policy: what to do with `dmarc: fail` and bulk mail — **store, don't auto-reply, show in Needs attention**.

Open questions for the spike are marked UNVERIFIED above. Nothing here is committed to.

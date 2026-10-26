# Inbound email channel — Phase 0 spike + Phase 1 MVP (branch claude/email-channel)

Spec: `tasks/email-channel-strategy-2026-10-26.md` (§4 threading, §4a forwarding model, §5 core changes, §6 phases, §7 defaults).
Defaults confirmed by Roger 2026-10-26: Resend inbound, forwarding first, dashboard is the reply surface, From
`"<Store> Support" <support@mail.hay.chat>` + Reply-To token, new plugin `plugins/core/email-channel` (`hay-channel-email`,
channel `email`), DMARC-fail/bulk → stored, not auto-replied.

## Phase 0 — spike (no product code)

- [ ] S1. Get Resend API access (prod SMTP_AUTH_PASS = Resend key, via Coolify env on homeserver; never print it)
- [ ] S2. Receive a Gmail auto-forwarded mail at the managed `<id>.resend.app` address; dump `headers` + `raw` → does
      `headers` include In-Reply-To / References / Auto-Submitted? Is `received_for` the original support@ address?
- [ ] S3. Send via Resend with custom `Message-ID`, `In-Reply-To`, `References`, `Reply-To` headers (API and SMTP) →
      which Message-ID does the recipient see? Is ours honoured?
- [ ] S4. Resend receiving GA vs beta; quota accounting; attachment URL expiry — write findings to the strategy doc §3
- [ ] S5. Add `inbound.hay.chat` receiving domain (API) + MX record on Cloudflare → verified

## Phase 1 — MVP (forwarding only)

Core (one commit each):
- [x] C1. `register.webhookRouting.signature.format: "svix"` (svix-id.svix-timestamp.body, whsec_ base64, `v1,` sigs) +
      `secretEnv: RESEND_WEBHOOK_SECRET`; routeKeyPath transform `"local-part" | "domain"` on `data.to[]`
- [x] C2. `messages.receive`: look up `findByExternalConversationId` first when `externalConversationId` given;
      accept `title` (subject) on new conversations
- [x] C3. plugin send: `email.send` tRPC capability (or extend `/send-email`) with from/replyTo/headers/attachments/
      messageId, returns the real Message-ID, surfaces failures (FAQ item 6, `plugin-api.service.ts:151-171`)
- [x] C4. (folded into plugin metadata: mid/subject/messageId/inReplyTo/references/holdReason) Message/conversation metadata shape for email (`metadata.email.{subject,from,to,cc,html,messageId,references,kind}`)

Plugin `plugins/core/email-channel`:
- [x] P1. Skeleton: package.json (`hay-plugin.category: channel`, `channel: email`), config (storeName, forwardingAlias
      read-only, idleAutoResolveDays), webhookRouting(svix), routes `/webhook` `/deliver` `/escalate` `/ui/*`
- [x] P2. Inbound: ack <15s → enqueue → fetch received email + attachments → classify (bounce/auto/bulk/echo/dmarc-fail)
      → reply-parser (strip quotes/signature) → thread match (token → headers → subject heuristic) → `messages.receive`
- [x] P3. Outbound `/deliver`: text+simple HTML, threading headers, Auto-Submitted, X-Hay-Conversation, Reply-To token,
      BCC merchant support@ (setting), store Message-ID
- [x] P4. Setup wizard UI (en + pt-BR): your support address → copy forwarding address → Gmail confirmation code
      capture → send test → status card; conversation header strip (subject/from/to) in dashboard
- [x] P5. Out-of-band reply detection → human-took-over + Needs attention
- [ ] P6. (deferred to Phase 2) Idle auto-resolve (scheduler) — may slip to Phase 2

Verify:
- [x] V1. Jest: svix verify, routeKey transform, thread matcher, classifier, reply-parser, deliver header builder
- [ ] V2. `npm run typecheck`, `npm run lint`, `npm run test:server`, plugin `npm test`, plugin build loads
- [ ] V3. Playwright `tests/email-channel-setup.spec.ts`: wizard end to end (chromium)
- [ ] V4. Independent reviewer agent on `git diff master...HEAD`; findings addressed/recorded here
- [ ] V5. Docs `docs/user-guide/integrations/email.md`; list hay.chat website lines to change in PR body
- [ ] V6. PR against master with verification story; WIP.md + lessons.md updated

Acceptance: a Gmail-forwarded shopper email creates an email conversation with subject as title; the AI reply reaches the
shopper threaded in their client; the shopper's reply lands in the same Hay conversation; a staff reply from the dashboard
goes out by email; bounces/auto-replies never trigger the AI; plugin failures are reported as failures.

## Working notes
- Only `sha256-hmac` signature format exists today (`packages/plugin-sdk/sdk/register.ts:233`).
- `findActiveByCustomerAndChannel` is the only thread lookup in `messages.receive` (`plugin-api/trpc.ts:217`).
- Resend webhook = metadata only; body via `GET /emails/receiving/:id`; attachment URLs 1 h; received mail counts in quota.

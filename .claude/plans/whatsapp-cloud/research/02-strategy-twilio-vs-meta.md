# WhatsApp: Twilio vs direct Meta Cloud API — strategic brief (research 2026-10-21)

Figures are Meta list rates in USD per _delivered_ message from the rate card effective 2026-10-01 unless stated. Vendor-blog numbers are flagged. Re-check against Meta's CSV rate card before quoting customers.

## Executive "so what"

1. Twilio's value-add is now mostly a tax: flat $0.005 per message **in both directions** (+ $0.001 per failed) on top of Meta pass-through. For a chatty AI support bot that fee is 2–3x Meta's own cost in BR/US.
2. Meta's model changed twice: per-message billing (2025-07-01) and, since **2026-10-01**, service replies are charged after 1,000 free per phone number per month and in-window utility templates are charged. The free tier is **per number**, so Hay's one-number-per-org model gets 1,000 free × N orgs going direct.
3. Going direct: each customer org adds its own card to its own Messaging account and Meta bills them directly. Hay stops carrying messaging COGS and stops re-billing.
4. Gating item is Meta process, not code: Business Verification (DONE for Hay) + App Review for `whatsapp_business_messaging` + `whatsapp_business_management` (two per-permission screencasts). Access Verification was dropped 2025-10-03.
5. Ship to early customers before App Review via (a) app-role testers in Development mode, or (b) a "manual / bring-your-own-token" path (customer's own Meta app + permanent system-user token + `phone_number_id`) — every OSS reference (Chatwoot, Typebot, n8n, Botpress) supports it. Keep (b) permanently as escape hatch.
6. Build Embedded Signup on **v4** only; v2/v3 died 2026-10-15. Coexistence (keep WhatsApp Business app on the phone) is a one-flag feature of v4+ and a real differentiator: Intercom, Tidio, Gorgias still force customers to delete the number from the app; Crisp and Chatwoot support it.
7. BSP "pass-through" middle paths (360dialog Partner Hub, Twilio ISV, YCloud) all still require Hay to become a Tech Provider past a handful of numbers. Distraction.
8. Brazil: BRL billing mandatory for new accounts since 2026-07-01 (R$0.035 utility/service, R$0.3217 marketing). WhatsApp reaches ~94% of Brazil's online audience; Pix via the Payments API (Brazil) is an upsell path once direct.
9. Policy risk low: Meta's 2025-10 ban targets _general-purpose_ AI assistants; customer-service AI is explicitly allowed.
10. Recommendation: go direct. Manual path first → Tech Provider App Review in parallel → Embedded Signup v4 with coexistence → drop Twilio. Design webhook ingest around `phone_number_id` routing + wamid idempotency from day one.

## 1. Cost comparison

### Twilio (pricing page, "current as of September 2026")

- $0.005 per WhatsApp message inbound AND outbound, Meta fees passed through at cost.
- $0.001 per message ending `failed`. No monthly sender fee. Volume discounts via sales only.

### Meta model

- 2024-11-01 service free. **2025-07-01** per-message pricing; in-window utility free. 2025-10-01 volume tiers for utility/auth.
- **2026-10-01**: service charged at the market's utility rate after **1,000 free per business phone number per month** (no rollover); in-window utility charged; status webhook `pricing.type` goes `free_customer_service` → `regular`. Inbound free. Free-entry-point (CTWA ad) windows stay free.
- 2026-07-01: "Meta Business Agent" category ($2.00 per 1M tokens ≈ 4–5¢/msg) — Meta's own AI agent, a competitor signal. BRL billing began for Brazilian accounts.
- Rate changes only Jan 1 / Apr 1 / Jul 1 / Oct 1, 1-month notice. Deadline 2026-09-30 to attach a payment method or service messaging stops after the free tier.

### List rates (USD, effective 2026-10-01)

| Market        | Marketing                                 | Utility           | Auth    | Service (after 1k free) |
| ------------- | ----------------------------------------- | ----------------- | ------- | ----------------------- |
| Brazil        | $0.0625 (R$0.3217)                        | $0.0068 (R$0.035) | $0.0068 | $0.0068                 |
| United States | $0.0250 (marketing paused since Apr 2025) | $0.0034           | $0.0034 | $0.0034                 |
| Germany       | $0.1365                                   | $0.0550           | $0.0550 | $0.0550                 |
| France        | $0.0859                                   | $0.0300           | –       | $0.0300                 |
| UK            | $0.0635                                   | $0.0220           | –       | $0.0220                 |
| Spain         | $0.0707                                   | $0.0200           | –       | $0.0200                 |
| Mexico        | $0.0397                                   | $0.0085           | –       | $0.0085                 |

### Worked example: 10,000 inbound-triggered service conversations + 2,000 utility templates / month

Assumptions: 5 inbound + 4 business replies per conversation → 50,000 inbound, 40,000 outbound; templates outside window; one phone number (worst case).

|         | Meta fees (direct)                           | Twilio platform fee         | Total via Twilio | Twilio overhead |
| ------- | -------------------------------------------- | --------------------------- | ---------------- | --------------- |
| Brazil  | 39,000×$0.0068 + 2,000×$0.0068 → **$278.80** | 92,000×$0.005 = **$460.00** | **$738.80**      | +165%           |
| US      | 39,000×$0.0034 + $6.80 → **$139.40**         | $460.00                     | **$599.40**      | +330%           |
| Germany | 39,000×$0.055 + $110 → **$2,255**            | $460.00                     | **$2,715**       | +20%            |
| Spain   | 39,000×$0.02 + $40 → **$820**                | $460.00                     | **$1,280**       | +56%            |

- Multi-tenant effect: same traffic spread over 40 customer numbers → free tier covers 40,000 service msgs → Meta service cost ≈ $0 in every market; Twilio's $460 unchanged.
- Twilio's fee scales with _total_ message count incl. inbound and bot verbosity; Meta's only with outbound.

## 2. Operational comparison

| Dimension               | Twilio (today)                                                                                                                                    | Direct Meta (Tech Provider + ES v4)                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End-customer onboarding | Twilio Self Sign-up / ISV Senders API → Meta portfolio → ES → OTP → Twilio sender registration → display-name review; sender async until `ONLINE` | Popup ES (FB Login for Business config id): create/select portfolio + WABA, OTP, returns `code` + `waba_id` + `phone_number_id`. Backend: exchange code → business token, `POST /{waba}/subscribed_apps`, `POST /{phone}/register` (PIN). ~3–5 min. Unverified customer = 250 business-initiated/24h cap and no display name. |
| Who holds the WABA      | Customer-owned WABA shared to Twilio (ISV) or Twilio-owned                                                                                        | Customer-owned; Hay's app gets a granted token; customer can revoke in Business Manager; Meta bills customer directly                                                                                                                                                                                                         |
| Portability             | Deregister + migrate (2FA PIN dance)                                                                                                              | Under the new account model: share the number with a new partner instead (see tech brief A5)                                                                                                                                                                                                                                  |
| Templates               | Twilio Content Template Builder/API                                                                                                               | Graph `message_templates` CRUD + `message_template_status_update` webhooks; build UI yourself                                                                                                                                                                                                                                 |
| Webhooks / retries      | Twilio posts to your URLs; `X-Twilio-Signature`; no auto retry (fallback URL only)                                                                | Single app-level callback for all tenants (or per-WABA/number `override_callback_uri`); `X-Hub-Signature-256`; at-least-once, retried with backoff up to 7 days on non-2xx; ack <5s; payloads up to ~3 MB; no ordering guarantee                                                                                              |
| Media                   | Twilio stores media until you delete                                                                                                              | Inbound: `GET /{media_id}` → 5-min URL → store yourself. Outbound: upload for id or public URL                                                                                                                                                                                                                                |
| Rate limits             | Meta's + Twilio pacing                                                                                                                            | 80 mps/number default, auto-upgrades to 1,000; tiers 250→2k→10k→100k→unlimited uniques/24h for business-initiated; own the outbound queue + 429/131056 backoff                                                                                                                                                                |
| Sandbox / dev           | Twilio sandbox (join code)                                                                                                                        | Meta test number + up to 5 recipients in dev mode                                                                                                                                                                                                                                                                             |
| Support                 | Twilio tiers                                                                                                                                      | Direct Meta support (slow historically)                                                                                                                                                                                                                                                                                       |
| What you must rebuild   | —                                                                                                                                                 | Outbound queue + retry, status normalisation, media download/storage, template CRUD/approval UI, phone health/quality handling, token reauthorization, per-tenant routing, idempotency. ~2–4 engineer-weeks for v1 given Hay's channel infra.                                                                                 |

## 3. Reference implementations

- **Chatwoot** (Ruby) — `app/services/whatsapp/*`. ES landed 2025 (PR #12344 "flexible onboarding: Manual + Embedded Signup"); coexistence fixes PR #15462 (2026-09-01). `embedded_signup_service.rb`: `TokenExchangeService` (GET `/oauth/access_token?client_id&client_secret&code`) → `PhoneInfoService` → `ChannelCreationService`/`ReauthorizationService` → `channel.setup_webhooks` → `HealthService`. `facebook_api_client.rb` does `POST /{waba}/subscribed_apps` (`messages`, `smb_message_echoes`) **plus** `POST /{phone_number_id}` with `webhook_configuration.override_callback_uri`, then `POST /{phone}/register` with PIN. Routing in `webhook_channel_finder_service.rb` keys on stored `phone_number_id`. Dedup `message_dedup_lock.rb`: Redis `SET NX EX` on wamid, TTL 1 day. Controller returns 200 immediately and enqueues a job. **Copy**: phone_number_id-primary lookup, SET-NX dedup, fast ack + job, reauthorization service. **Avoid**: plaintext tokens in jsonb. Bugs you will hit too: #14690 scope-name drift in `debug_token`, #16111 `FB.login` before `FB.init`, #14859 "Business can't onboard customers" (= Tech Provider status).
- **Typebot** (TS) — `packages/whatsapp/src`: BYO Meta app model (system-user token + phone number id, AES-encrypted). Per-tenant webhook URL rather than payload routing; `verifyWhatsAppWebhookSignature.ts`, `groupIncomingWebhookEntriesPerUser.ts`. **Copy**: per-tenant verify token, media proxy. **Avoid**: no wamid idempotency.
- **Botpress** (TS) — `integrations/whatsapp/src`: manual / sandbox / OAuth ES modes. `auth.ts` `MetaOauthClient`: `GET /oauth/access_token`, `debug_token` → `granular_scopes.whatsapp_business_messaging.target_ids` to discover WABAs, `GET /{waba}/phone_numbers`, `subscribed_apps`, `/register` with a global PIN secret. **Copy**: deriving WABA ids from `debug_token`. **Avoid**: `entry[0]?.changes[0]` only, non-timing-safe compare, no dedup, pinned to v19.
- **n8n WhatsApp Trigger** — one webhook per Meta app; reminder that the app-level callback is global: one stable ingest URL (or per-number overrides).
- **Evolution API / WPPConnect** — Baileys-class unofficial clients; not applicable (ban risk).
- **Meta `WhatsApp-Nodejs-SDK`** — archived 2023-06-07. Don't use. Maintained alternatives: `meta-cloud-api` (v3.9.x, Graph v23), `@great-detail/whatsapp`, `whatsapp-api-js`. Verdict: the surface Hay needs is ~10 endpoints; a thin typed client inside the plugin beats a dependency.
- **Idempotency/ordering consensus**: at-least-once, retries up to 7 days; key on `wamid` / `statuses[].id`; Redis SETNX + DB unique index; iterate every `entry[]`/`changes[]`; raise Express body limit (default 100 KB vs 3 MB payloads → 413 → infinite retries); status webhooks can arrive before your send call returns, so upsert by wamid; serialise per conversation using `timestamp`.

## 4. Becoming a Meta Tech Provider

- Steps: Meta app with WhatsApp use case → Tech Provider onboarding → Business Verification (before App Review) → App Review with icon, privacy policy URL, category, **two videos**: (1) message sent from your UI and received in WhatsApp, (2) template created in your UI or WhatsApp Manager → Advanced access for both permissions (without it, calls on client assets return error 200). "Allowed usage" text should say you are a Tech Provider managing clients' numbers and templates.
- **Access Verification removed 2025-10-03**. Twilio's ISV guide (Oct 2026) still lists it — outdated.
- Timelines reported: Business Verification 2–5 business days to several weeks; App Review commonly 2–7 business days (one 2026 claim of up to 20 days, unverified).
- Common rejections: legal name/address mismatch between documents, Business Manager and website footer; one video covering multiple permissions; video not clearly showing send+receive; requesting unnecessary permissions; unreachable privacy policy.
- Launching before approval: (a) Development mode — anyone with an app role sees full permissions in ES; practical for 3–10 design partners but each customer admin must accept a Facebook app role. (b) Manual path — customer's own Meta app (Direct Integrator, no review), permanent system-user token, paste `phone_number_id` + token into Hay. Zero Meta approval needed on Hay's side.
- ES v2/v3 deprecated 2026-10-15; v4 is a FB Login for Business _configuration_; legacy feature types do not auto-migrate.

## 5. Competitive landscape

| Vendor         | How connected                                                                      | Coexistence                                  |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| Intercom       | Own BSP; ES; number registered exclusively to Intercom's WABA; billed via Intercom | No (support confirmed no roadmap, Sept 2026) |
| Zendesk        | Own BSP (Sunshine); ES                                                             | Not documented                               |
| Crisp          | Own BSP; ES                                                                        | **Yes**                                      |
| Front          | ES popup                                                                           | Not documented                               |
| Freshdesk      | Native; ES                                                                         | Not documented                               |
| Gorgias        | ES; absorbs Meta fees                                                              | No                                           |
| Tidio          | ES via FB login modal                                                              | No                                           |
| Chatwoot (OSS) | Tech Provider (cloud) or BYO app                                                   | **Yes** since Sept 2026                      |

Everyone uses ES; nobody serious routes via Twilio. Coexistence + customer-owned WABA + Meta-direct billing is honest differentiation against Intercom/Gorgias/Tidio for SMB/BR customers who live in the WhatsApp Business app.

## 6. Middle path: BSP with ES pass-through

- 360dialog: €49/€99/€500 per number/month direct; Partner Platform €250–1,000/mo + per-channel; must register as Tech Provider to onboard >3 numbers anyway.
- Twilio ISV: still your own Meta app + App Review; fee unchanged.
- Gupshup ~$0.001–0.004/msg + markup; weak Brazil presence. YCloud/Infobip require Tech Provider status.
- Verdict: distraction. Fixed €/number kills SMB unit economics in Brazil; still need Tech Provider status.

## 7. Brazil / LatAm, EU

- WhatsApp used by ~93.7% of Brazil's online audience; ~10M businesses on WhatsApp Business.
- BRL billing since 2026-07-01 for new accounts; existing non-BRL accounts must migrate by 2027-06-30. R$0.3217 marketing, R$0.035 utility/auth/service.
- Payments API (Brazil): `order_details` interactive message with dynamic Pix code, payment link, boleto, card; needs a Meta-approved Brazilian PSP. Phase-2 upsell for e-commerce customers (Shopify/Wix plugins).
- Coexistence available in Brazil (and EEA/UK since 2025-10-23); 20 mps cap; 6-month history sync; no groups/broadcasts.
- LGPD: legal basis per category; keep opt-in records per phone; honour "PARE/stop".
- Policy: 2025-10 terms bar general-purpose AI assistants (enforced 2026-01-15); customer-service AI explicitly permitted; EU interim order June 2026 forced reinstatement for rivals anyway.
- EU DMA third-party chats (Nov 2025): consumer-only; no effect on Business API as of Oct 2026.

## Sources

- Meta pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta changelog: https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- Tech Provider get-started: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- App review: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- Coexistence: https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
- Payments BR: https://developers.secure.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/overview/
- Twilio pricing: https://www.twilio.com/en-us/whatsapp/pricing ; ISV guide: https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide
- Rate table: https://getkanal.com/blog/whatsapp-business-pricing-guide ; Oct-2026 explainers: https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026
- BRL rates: https://whautomate.com/whatsapp-business-api-pricing-brazil
- Access Verification removal: https://www.socialmediatoday.com/news/meta-removes-access-verification-for-developers/832678/
- ES v4 migration: https://360dialog.com/blog/embedded-signup-versions-migration/
- Chatwoot: https://github.com/chatwoot/chatwoot/tree/develop/app/services/whatsapp ; PR #12344
- Typebot: https://github.com/baptisteArno/typebot.io/tree/main/packages/whatsapp/src
- Botpress: https://github.com/botpress/botpress/tree/master/integrations/whatsapp/src
- Node SDKs: https://www.npmjs.com/package/meta-cloud-api ; https://github.com/great-detail/WhatsApp-JS-SDK ; https://github.com/Secreto31126/whatsapp-api-js
- Webhook reliability: https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices
- Intercom coexistence thread: https://community.intercom.com/inbox-9/meta-coexistence-api-14596 ; Crisp: https://help.crisp.chat/en/article/connect-whatsapp-business-platform-with-crisp-11rcwkw/
- 360dialog: https://360dialog.com/pricing
- AI policy: https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform

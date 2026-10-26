# Prospect FAQ: code-grounded answers (2026-10-26)

Answers to Damien's 14 questions, verified against hay-core, hay-backoffice, hay-website and hay-shopify.
Paths relative to /srv/hay-core/repo unless prefixed (BO = /srv/hay/hay-backoffice, WEB = /srv/hay/hay-website/src).

## 1. Handoff / out of hours / AI disclosure
- Handoff fires when the planner picks HANDOFF (`server/prompts/en/execution/planner.md:69-87`): customer asks for a person,
  AI can't fulfil, tool failed, AI would promise human follow-up. Guardrails force it: false action claim (Stage 0),
  company-policy violation (Stage 1), low confidence (Stage 2, thresholds 0.8/0.5, `organization-settings.types.ts:268-279`),
  5 failed processing attempts (`message-recovery.service.ts`). Sentiment never triggers it.
- No business-hours feature. AI answers 24/7. "No human available" = no user with status available seen in last 120s
  (`server/repositories/user.repository.ts:11-23`). Then agent follows owner's "if all human agents are unavailable"
  instructions (`dashboard/pages/agents/[id].vue:217-235`), else says "no human agents are currently available".
  No ticket/email created automatically. Widget has no offline state (`webchat-settings.entity.ts:41`).
- Disclosure: system prompt `server/prompts/en/conversation/system-instructions.md:8,29,30` ("Never impersonate a human,
  you are an AI assistant"). No AI badge in the widget; header shows the agent's name.

## 2 & 10. Order actions
- Shopify (20 tools, all real Admin GraphQL, `plugins/core/shopify/mcp/tools/`): full+partial refund (bounded by
  refundable amount, idempotency key), cancel (refund-on-cancel flag is a TODO, orders.js:417-420), change shipping address
  pre-dispatch only, returns (open state), tracking, lookups. NO line-item edit, NO exchange, NO coupons, NO resend confirmation.
- WooCommerce (`plugins/core/woocommerce/mcp/index.js`): 113 WC + 7 WP tools, raw REST passthrough, `z.record(z.any())`.
  Refund/cancel/edit/address/coupons all possible, nothing bounded or customer-scoped. NO tracking tool.
- Wix: refunds (full/partial) + fulfillment; no cancel/address. Magento: product/revenue read-only, no order actions.
  Stripe: hosted MCP, tools not in repo.
- Only gate: tool must be referenced by an active playbook (`conversation.entity.ts:268-470`, `run.ts:923-955`).
  Plus action-claim guardrail blocks "I've cancelled it" without a successful tool call. No refund toggle/cap/approval.

## 3, 8, 14. Billing
- Plans (BO/billing-plans.json, EUR): Solo 50/mo 500 incl, 0.25 overage; Starter 135/2,000/0.20; Growth 725/20,000/0.15;
  Enterprise 2,725/100,000/0.10. Annual = 10% off. Pilot 50% forever coupon. Stripe prices EUR only; site shows USD/GBP/BRL.
- Resolution = conversation `status = resolved` created in period (`analytics.service.ts:82-87`, BO usage-tracking.service.ts:51).
  Counted: customer closes (satisfied OR unsatisfied), inactivity auto-close at 30 min (`conversation-utils.ts:262-271`).
  Not counted: staff Close (`closed`), pending-human/human-took-over (never auto-closed), empty convos (deleted at 60 min).
  No spam detection. Playbook flows count like any other.
- At limit: no stop, no warning. Overage via Stripe meter `resolution_overage` every 4h. BUG: annual plans compare monthly
  allowance against the whole year (BO usage-tracking.service.ts:41-55).
- Plan change: Stripe Customer Portal only (behaviour = portal config). hay.chat/billing "Change plan" → new Checkout →
  second subscription (BO billing.ts:357-421). Nothing auto-downgrades. `cancelSubscription()` never called.
- Trial 30 days, no card (BO account.entity.ts:21, onboarding.ts:896-907). Emails day 14/23/29 + expired.
- Money-back guarantee only in WEB/refund-policy.md:16-34; zero refund code. Pricing page `moneyBack` key now shows trial text.
- Suspension automatic: trial expired, 14 days after first payment_failed, subscription deleted. Manual admin lock is the
  only human-reviewed path. Lifted automatically on invoice.paid/checkout. Purge at 90 days (emails day 45/85).
- Emails: trial lifecycle, payment-failed (day 0, day 7, lock), deletion warnings. None for renewal/invoice/usage threshold.
- Terms: billed in advance, non-refundable except refund policy, 30 days' notice termination. Refund policy: monthly no
  refund, annual 10% early-termination fee, downgrades next cycle, upgrades prorated. None enforced in code.

## 4. Sources / correction / draft mode
- Sources: `metadata.documentsUsed` + confidence on every AI message (`run.ts:176-193`); shown to owner in "Reasoning
  overview" dialog (`ChatMessage.vue:345-480`). Shopper never sees them. Public API leaks metadata to browser
  (`public-conversations/index.ts:192`).
- Feedback: thumbs up/down + comment (`MessageFeedbackControl.vue`), stored only, not used at answer time.
  "Improve from conversation" → LLM-proposed playbook edits → apply to draft (`playbook-suggestion.service.ts:225-327`).
- Draft mode = Test Mode / "Require Approval" per agent or org (`agent.entity.ts:77`, `settings.testModeDefault`).
  CAVEAT: approval doesn't trigger delivery (`conversations/index.ts:931` TODO); webchat gets it via polling,
  WhatsApp/Instagram/Chatwoot never. "Supervise" toggle does nothing.

## 5. Portuguese naming
- Existing copy: "agente"/"agente de IA" dominant (website ~49, dashboard ~46 hits), "atendimento" for the service,
  "assistente" rare, "chatbot"/"robô" only pejoratively about competitors. Website has pt (pt-BR) + pt-pt locale layers.

## 6. vs Shopify Inbox
- Not implemented: timezone-aware answers (org.timezone only formats dashboard dates; LLM gets no current date),
  localised links (single sourceUrl), contact capture (no pre-chat form).
- Real: multi-channel (web, WhatsApp, Instagram, Chatwoot), real order actions, playbooks + AI-suggested edits,
  catalog sync + recommend_products cards, confidence guardrails, approval mode, GDPR DSAR export, docs audit, 13 widget locales.

## 7. Export
- Per conversation, PDF or CSV (`conversations.export`, `conversation-export.service.ts`). UTC timestamps, channel,
  sender type (Customer/Human Agent/Bot Agent/System/Tool/...), tool name, attachment names. Any channel. No bulk/JSON.
- GDPR export: signed ZIP with data.json per customer (`privacy.service.ts:1678-1873`).

## 9. Languages
- Reply: per-message detection (ISO-639-1), "respond ONLY in {language}" enforced for first 3 customer messages
  (`execution.layer.ts:240-266`). 33-code enum (`language.types.ts`). Prompt templates: en, es (partial), pt.
  Agent "Response language" field only picks template language, doesn't force reply.
- UI: dashboard en + pt-BR; widget 13 (en-us, pt-br, pt-pt, es-es, de-de, it-it, fr-fr, nl-nl, pl-pl, ja-jp, zh-cn,
  ko-kr, tr-tr); emails en + pt-BR; plugin UIs mostly en + pt-BR.

## 11. Mobile
- No app, no PWA, no push. Dashboard not responsive (mobile sidebar trigger commented out `layouts/default.vue:6`,
  fixed `w-80` panel). Alerts only in-browser (toast + beep + Notification) while a tab is open. Takeover = "Take Over"
  button; no reply-by-email/WhatsApp. docs faq.md:335 "works on phones" overstated.

## 12. Email
- No email channel. `plugins/core/email` = outbound send-email to fixed recipients, From noreply@updates.hay.chat via
  platform SMTP. No inbox, OAuth, custom domain, DKIM, threading, bounce handling. Plugin send failures reported as
  success (`plugin-api.service.ts:151-171`).

## 13. Off switch
- Webchat: Settings > Webchat "Enable webchat" → widget renders nothing, no message. One step, webchat only.
- Agent "Enabled" switch: stored, never read (`conversation.service.ts:50-63`, `run.ts`). Does nothing.
- Per conversation: Take Over stops AI. Unfinished → pending-human ("Needs attention"). Any new customer message flips
  pending-human/resolved back to open and AI replies again unless a human took over (`conversation.entity.ts:912-933`).

## Fix or stop claiming (priority)
1. Pricing page: "unresolved don't consume", "notify approaching limit", "prorate immediately" are all false in code.
2. Annual plan metering bug (monthly allowance vs yearly period).
3. "Change plan" creates a second subscription.
4. Agent Enabled switch no-op.
5. Approval-mode delivery TODO (never reaches WhatsApp/Instagram).
6. Email plugin failures reported as success; SMTP retry queue in-memory.
7. Public conversation API leaks documentsUsed/confidence/rationale.
8. Docs: "over 50 languages", "works on phones", "appears in your Queue", agent enable semantics.

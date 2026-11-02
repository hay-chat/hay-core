# Changelog

All notable changes to Hay.chat are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-02

First public release. It covers the work merged from 2026-10-26 onwards.

### Added

**Self-hosting**

- Run Hay.chat on your own server: one Docker image, a compose stack and a self-hosting guide (`SELF_HOSTING.md`).
- Switches to turn off public sign-up and to require email verification.

**Assistant and conversations**

- One AI assistant per organization. Its name, avatar, greeting and hand-off rules are set in the organization settings.
- Quick check with the team: the AI can ask your team a question in the middle of a chat and send the answer back to the shopper.
- Business hours per channel. Hand-offs know if the team is open, closed or offline, and the shopper sees when you will be back.
- Email follow-up: if a web shopper leaves, they get the human reply by email with a link back to the chat.
- A helpdesk ticket is raised when nobody can take a hand-off.
- Playbooks get a "Hand off to a human" step, which counts as a success.
- Forms: a pre-chat form for the widget and forms the AI can send during a chat.
- Check-in and auto-close times now depend on the channel (WhatsApp, email, webchat and so on).
- The AI only shares links it can verify. It finds the right page from your website's sitemap, and dead links are fixed or dropped before the reply goes out.
- Photos and files in chats: shoppers can send images, the AI can read them, and card and ID photos are hidden from it.
- Pause the AI everywhere with one switch.

**Actions and approvals**

- Every tool has a risk level. Risky actions, such as refunds, cancellations and coupons, can wait for a person to approve them.
- Approvals list, an action log, typed confirmation for destructive actions, and an option to approve a lower amount.
- Drafts-only mode per channel: the AI writes the reply and a person sends it.

**Commerce and payments**

- Nuvemshop integration with partner OAuth.
- Mercado Pago integration: find payments, resend Pix and make capped refunds.
- Shopify and WooCommerce: order exchanges and swaps, resend confirmations, return instructions, Pix and payment links, and goodwill coupons with a limit.
- Chargebacks: Stripe and Shopify Payments disputes reach the owner with a ready evidence pack.
- One-click WooCommerce connect from the WordPress plugin.

**Channels and widget**

- Facebook Messenger channel.
- WhatsApp message templates and 24-hour reply window handling.
- Page tools (WebMCP): the AI can run actions inside the visitor's browser on your site.
- Customizable CSAT rating at the end of a chat.
- Spam protection: Cloudflare Turnstile, a Spam view and an under-attack mode.
- An "AI" label on AI replies. You can rename it.
- The widget answers in the shopper's language and is a smaller download (128 KB to 43 KB).

**Insights and testing**

- Insights page: ratings and conversations become grouped issues with evidence, plus a weekly digest.
- Improve your knowledge base from any conversation.
- Test a playbook draft before publishing, replay past conversations with an AI judge, and see a go-live readiness card.
- Import past transcripts from Tidio, Gorgias or CSV.

**Account and billing**

- Settings > Usage shows billable resolutions. You can exclude chats that should not count.
- Export all your workspace data as a ZIP.
- EU-only AI processing per organization.
- Team alerts by push and email when a shopper is waiting, with an iPhone install guide and a lock-screen privacy option.
- Spacebring integration.

### Changed

- Navigation simplified: the main sidebar goes from 15 entries to 9, and Settings from 13 to 6 sections.
- New plugin setup page with a status header, tabs and a setup checklist.
- Hand-offs say honestly whether someone is online, in English and Portuguese.
- The dashboard shows real response times and top-agent numbers, with no made-up trends.
- New organizations keep conversations for 365 days by default.
- Dashboard logins last up to 90 days and network errors no longer log you out.
- Requires Node 22.12 or later.

### Removed

- The separate "Agents" section. The organization is now the assistant.
- The Analytics and Reports pages. They are replaced by Insights and the dashboard home.

### Fixed

- The first message in a new chat always gets an answer.
- The AI no longer keeps replying after a team member takes over or pauses a chat.
- Saving plugin settings no longer wipes stored secrets.
- Playbooks written as plain text are no longer treated as empty.
- If the AI provider is down, Hay retries once and then hands off to your team.
- Mobile layout fixes: no zoom on iOS inputs, and message bubbles stay on screen.
- GPT-5 and o-series model requests work again.

### Security

- A full security review and hardening pass across login and roles, plugins, file uploads, outbound requests, WebSockets, AI prompts and audit logs.
- Uploaded media and document images are private and served through signed links.
- Privacy requests (export and erasure) run as background jobs and cover all customer data, including requests from Shopify and other providers.
- Tools that touch customer data only work for the verified customer.
- Rate limits and allowed-domain checks on the public widget.

[0.1.0]: https://github.com/hay-chat/hay-core/releases/tag/v0.1.0

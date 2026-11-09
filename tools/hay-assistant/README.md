# Hay's own assistant

The content, playbooks and load script for the Hay.chat assistant that supports and sells Hay.chat itself: on hay.chat, at events such as Web Summit, and inside the dashboard. It runs on a normal Hay.chat org; this folder is what that org is loaded with.

Everything customer-facing is sourced. Each knowledge document lists its sources and verification date in its front matter, and open questions are `TODO(Roger)` lines in the front matter (the loader sends only the body, so they never reach customers). `grep -rn "TODO(Roger)" tools/hay-assistant` lists them all.

## Who talks to it (prioritised)

| # | Who | What they need | Served by |
|---|---|---|---|
| 1 | Visitor or prospect on hay.chat | "Why is Hay better?", how it compares, what it costs, a demo | Why Hay and comparisons, Pricing and plans, Book a meeting |
| 2 | Web Summit contact | The short pitch, pricing, and a call with the founders booked in the chat | Book a meeting, Why Hay, Pricing |
| 3 | Trial user mid-setup (in the dashboard) | Where is X, connect the store, install the widget, add knowledge, write a playbook, handoff | Help me set up (plus the three how-to documents) |
| 4 | Privacy or security reviewer | Where data lives, GDPR, DPA, certifications | Privacy, GDPR and EU data |
| 5 | Developer or self-hoster | Licence, Docker install, plugins | Self-hosting, licence and plugins |
| 6 | Paying customer | Usage, plan change, cancel, refund policy | Billing and account help (explains, never acts) |
| 7 | Partner or press | Contact, press kit, integration requests | Escalate to the team, contact document |

## Playbooks (8) and what is knowledge-only

`playbooks/`, same format and front matter as `tools/demo-account/playbooks/shopify/`.

1. Book a meeting with the Hay.chat team (Cal.com tools)
2. Why Hay.chat and how it compares
3. Pricing and plans
4. Help me set up Hay.chat
5. Billing and account help
6. Privacy, GDPR and EU data questions
7. Self-hosting, licence and building plugins
8. Escalate to the Hay.chat team

Kept as knowledge only, covered inside playbook 4: connect a store or channel, install the widget, add knowledge, write a playbook, human handoff setup. They are one-step-at-a-time answers from a document, with no tool calls and no decision logic, so one playbook that routes to the right document beats five near-identical ones. Playbooks 2, 3, 5 and 6 exist even though they are mostly knowledge because each carries a rule that must hold every time: dated competitor facts, currency discipline, never promising a refund, and the EU storage versus AI-processing distinction.

## Knowledge documents (12)

`knowledge/`: why Hay, comparison, how it works, plans and pricing, privacy/GDPR/EU, self-hosting and licence, integrations and channels, three dashboard how-tos (get started, connect and widget; knowledge and playbooks; handoff, approvals, team, billing), building a plugin, company and contact. Titles start with "Hay.chat" so they do not collide with existing documents in the org.

Dashboard how-tos use the menu names of the sidebar (Settings > Assistant, Knowledge > Documents, Integrations > Marketplace, ...), checked against master and the docs audit (`hay-docs-ui-audit` user-guide). Production already has the Set up board, two-factor and Active Sessions (confirmed by screenshots), so the how-tos use the Set up board as the main path for new customers and cover 2FA. Page tools (Settings > Channels > Webchat) are not confirmed on production, so they are left out.

## Load it

```bash
# preview, nothing is sent and no credentials are needed
node_modules/.bin/tsx tools/hay-assistant/scripts/seed-hay-assistant.ts --org <org-id> --dry-run

# load documents and playbooks (playbooks active)
node_modules/.bin/tsx tools/hay-assistant/scripts/seed-hay-assistant.ts --org <org-id>

# also replace the assistant's name, tone, avoid list and instructions
node_modules/.bin/tsx tools/hay-assistant/scripts/seed-hay-assistant.ts --org <org-id> --only docs,playbooks,assistant

# playbooks as drafts instead of active
... --draft
```

`tsx` is also at `server/node_modules/.bin/tsx`. It reuses the Casa Aurora engine (`tools/demo-account/scripts/hay`): documents and playbooks are matched by title and updated in place, so re-running is safe and unchanged documents are skipped. `--org` is required, so nothing can land in the wrong org. Auth: `HAY_API_KEY` (org API key), or `HAY_EMAIL` + `HAY_PASSWORD`, or `hay login` first; `--target prod|local`.

Tests: `cd tools/hay-assistant && ../../node_modules/.bin/vitest run`.

## Go-live checklist

1. Cal.com plugin connected in the org (Integrations > Marketplace > Cal.com > Connect) with a Cal.com API key (Settings > Developer > API keys, starts with `cal_`) of the account that owns the "Quick chat" event type (30 minutes, 2 hours notice). Booking is calendar-only, but `create_booking` is classed "other write": if Settings > Assistant > Actions asks approval for "Other actions", bookings will wait for a person. Switch that off for this org. Cancelling always waits for approval.
2. Archive or retitle any older Hay documents in the org that disagree with `04-plans-and-pricing` (the current assistant answered a pricing question from an old "pricing guide" with figures that are not on the pricing page).
3. Settings > Channels > Webchat: Allowed Domains include hay.chat (the dashboard host is exempt); optionally enable page tools so the in-app assistant can open pages.
4. Dashboard embed: set `SUPPORT_WIDGET_ORG_ID=<org-id>` for the dashboard (build or runtime env; `NUXT_PUBLIC_SUPPORT_WIDGET_ORG_ID` also works at runtime). Unset means no widget.
5. Resolve or consciously accept the `TODO(Roger)` items.
6. Founder Sprint is deliberately not in the content: its name and link are unconfirmed. To add it back, restore a section to `knowledge/04-plans-and-pricing.md` (terms are on hay.chat/founder-sprint/: 10 stores, 90 days of weekly founder help, 50% off) and a line to the pricing playbook.
7. Test with `hay chat send --org <id> "Why is Hay better than Intercom Fin?" --logs` and the questions in the playbook triggers.

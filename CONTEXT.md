# CONTEXT

**Current Task**: Billing slice 2 (currencies, usage alerts 50/80/100, overage switch, in-place plan change) across hay-backoffice, hay-core, hay-website, hay-docs; code done, reviewer agent running.

**Key Decisions**
- Overage off + 100 % → `agentPause` access-state field (AI parked, dashboard usable), not a suspension.
- One Stripe price per plan/interval with `currency_options`; currency chosen at checkout, locked afterwards.
- All plan changes in place with `create_prorations`; refund policy §4 must change (website copy listed in PR).

**Next Steps**
- Address reviewer findings, push `claude/billing-usage-limits` (+ hay-docs `claude/billing-usage-docs`), open stacked PRs.
- Roger runs `npm run stripe:sync` in test/live and the two migrations.
- Follow-up: admin UI for currency/overage; renewal reminder email (slice 3).

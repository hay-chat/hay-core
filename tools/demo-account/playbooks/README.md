# Playbooks

Step-by-step instructions the Casa Aurora AI agent follows in a given situation, one set per
store: `shopify/` (US, en), `woocommerce/` (Europe, en) and `nuvemshop/` (Brasil, pt-BR). Each
playbook names the scenario IDs from `SCENARIOS.md` it covers in its description.

| Situation | Shopify | WooCommerce | Nuvemshop |
| --- | --- | --- | --- |
| Where is my order, stale tracking, refund demand, confirmation email | 01 | 01 | 01 |
| Cancel before shipping | 02 | 02 | 02 |
| Address change / scent swap before shipping | 03 | 03 (swap → team) | 03 (swap → team) |
| Damaged item, photos, refund or replacement | 04 | 04 | 04 (refund request only) |
| Return / 7-day withdrawal (BR) | 05 | 05 | 05 |
| Refund status | 06 | 06 | 06 |
| Payment pending (link / bank transfer / Pix and boleto) | 07 | 07 | 07 |
| Goodwill coupon within the 10 % cap | 08 | 08 | 08 |
| Delivered but not received, missing item | 09 | 09 | 09 |
| Product and care questions | 10 | 10 | 10 |
| Wholesale (30+ units) | 11 | 11 | 11 |
| Mercado Livre / Shopee orders | | | 12 |

## File format

```markdown
---
title: Cancel an order before it ships        # idempotency key in Hay.chat
trigger: The shopper wants to cancel an order # one line, max 255 characters
description: What it does. Scenarios CHG-01, CHG-04.
approvalCategories: [cancel, refund]          # optional, tighten-only (server APPROVAL_CATEGORIES)
---

## Check the order
1. Find the order with {{action:shopify_get_order_by_name}} ...
```

- `{{action:<tool>}}` becomes an action chip (a Tiptap `mention` node with
  `id: "<pluginId>:<tool>"`), exactly as the dashboard editor saves it. The plugin comes from the
  tool prefix: `shopify_` → `hay-plugin-shopify`, `woocommerce_` → `hay-plugin-woocommerce`,
  `nuvemshop_` → `hay-plugin-nuvemshop`.
- Use only tools the store's plugin registers (`plugins/core/<platform>/mcp/tools/*.js`). The
  test suite and every seed run check this offline; the server's `actionWarnings` are printed too.
- Supported markdown: `#`/`##` headings (deeper levels become `##`), paragraphs, flat `-` and
  `1.` lists (indent a line to continue an item), `**bold**`, `*italic*`, `` `code` ``. No nested
  lists or tables.

## Rules the playbooks follow

From the shipped templates (`server/services/product-case/templates.ts`) and `company/brand.md`:
look the order up first; ask the shopper before any write; never say a refund, cancellation,
coupon or change happened before the tool result says so; say "I've asked the team…" when an
action is held for approval; state policy deadlines and hand exceptions to the team; never
accuse a shopper; say honestly whether anyone is online. Write "Hay.chat", never bare "Hay".

## How they're loaded

`scripts/seed-hay.ts` creates or updates each playbook by title, attaches it to the
"Casa Aurora Assistant" agent (keeping other agents already attached) and sets its status:
**active by default** so the demo AI uses it straight away (draft playbooks are never selected);
`--draft` writes them as drafts instead. Approval categories are set with a follow-up
`playbooks.update` because `playbooks.create` doesn't take them.

```bash
tools/hay-cli/bin/hay demo seed hay --platform nuvemshop --only playbooks
node_modules/.bin/vitest run --root tools/demo-account     # format + tool-name checks
```

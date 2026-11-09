---
title: "Hay.chat: plans and pricing"
type: reference
verified: 2026-11-09
sources:
  - hay-website src/_data/pricing.js (all prices and included resolutions)
  - hay-website src/pricing/en.locale.js and pt.locale.js (FAQ, resolution definition, trial)
  - hay-website src/llms.njk (overage cap, currencies)
todo:
  - TODO(Roger) Enterprise terms beyond the price (SLA, contract) are not published. The assistant offers a call.
  - TODO(Roger) Prices change. Re-check src/_data/pricing.js against what Stripe actually bills before go-live.
---
# Hay.chat plans and pricing

One flat monthly price per plan, a set number of resolutions included, and no per-seat fee. No setup fee. All plans have the same features; they differ on volume, overage rate and support.

You can pay in EUR, USD, GBP or BRL. ALWAYS state the currency with the number and quote only the currency the person asked about or that matches their country. Never convert between currencies yourself and never mix symbols. The English pricing page is hay.chat/pricing/ (EUR by default) and the Portuguese one is hay.chat/pt/preco/.

## Monthly prices and overage per extra resolution

| Plan | Included resolutions | EUR | USD | GBP | BRL (R$) |
|---|---|---|---|---|---|
| Solo | 500 | EUR 50 | US$55 | GBP 45 | R$200 |
| Starter | 2,000 | EUR 135 | US$149 | GBP 119 | R$540 |
| Growth | 20,000 | EUR 725 | US$799 | GBP 649 | R$2,900 |
| Enterprise | 100,000 | EUR 2,725 | US$2,999 | GBP 2,449 | R$10,900 |

Overage per extra resolution:

| Plan | EUR | USD | GBP | BRL (R$) |
|---|---|---|---|---|
| Solo | 0.25 | 0.27 | 0.22 | 1.00 |
| Starter | 0.20 | 0.22 | 0.18 | 0.80 |
| Growth | 0.15 | 0.16 | 0.13 | 0.60 |
| Enterprise | 0.10 | 0.11 | 0.09 | 0.40 |

- Annual billing saves 10%.
- Support: Solo has email support, Starter and Growth priority support, Enterprise a dedicated success manager (with custom terms).
- Overage is on by default and capped at 150% of your plan for new accounts. At the cap the AI pauses and new chats go to your team. You are notified as you approach your limit.
- Plan changes: upgrades take effect immediately and the difference is prorated. A lower plan, or moving from annual to monthly, starts at the next billing date.
- Sizing guide: ~500 resolutions a month fits Solo (a single owner answering everything), ~2,000 fits Starter (a small team keeping up), 20,000 Growth. If someone gives a volume, recommend the plan whose included resolutions cover it and say the figures above. Do not promise savings you cannot calculate from these tables.

## Free trial
30 days free from sign-up, no credit card. Start at hay.chat/get-started/ .

## What is a resolution (what you are billed for)
A resolution is a conversation the AI resolved: the shopper asked for something real (an order status, a refund, an address change) and the AI answered it. It counts when the shopper confirms it worked or goes quiet after the answer. An action the AI sends for your approval also counts, even if you decline it, because the agent followed your rules.

It never counts: greetings and thank-yous with no real request, conversations the AI did not answer, conversations where the shopper said it did not help, empty chats, test chats, spam. A shopper who comes back within 72 hours of a resolution reverses the charge.

You can check what you are billed for in Settings > Billing & Usage > Usage in the dashboard: every billable resolution with its transcript, exportable as CSV. If one should not count, exclude it there with a reason (up to 5% of the month's resolutions at once; beyond that the Hay.chat team reviews).

## Not published
Discounts for non-profits or startups, custom contracts, invoicing terms, volume discounts above Enterprise, and any price not in the tables: do not answer; offer a call or hello@hay.chat.

Sources: hay.chat/pricing, hay.chat/pt/preco, hay.chat/llms.txt.

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: owners and support leads at online stores, usually on Shopify or WooCommerce, setting up AI customer support themselves. They often arrive with limited time and may not be in the mood for a long setup on first login.

Also served, with the same flow and shorter defaults: SaaS companies, service providers and other businesses. Self-hosted operators and Shopify App Store merchants enter without going through the website signup.

## Product Purpose

Hay lets a business run AI agents that resolve customer requests across channels, grounded in its documents and guided by playbooks, with handoff to humans. Success for a new account is an assistant that really works for that business, not a finished checklist. Without knowledge and playbooks the app can do very little, so setup is the core of activation.

## Positioning

The agent takes actions instead of only answering: it looks up orders, issues refunds and updates orders through connected platforms, with a human approval step available on any action. Flat monthly plan with no per-seat fees, and self-hostable.

## Operating Context

- Hosted signup starts on the website (hay-website, hay-backoffice), then hands off to the dashboard. Self-hosted and Shopify App Store users start in the dashboard or apps.hay.chat.
- Knowledge comes from website crawls, uploaded files and document plugins. Actions and channels come from plugins.
- Past conversations can be imported as transcripts and replayed against the assistant in a dry run.

## Capabilities and Constraints

- Core must never hardcode plugin IDs. Suggestions of platforms must come from plugin manifests or the registry.
- Dashboard copy ships in English and Brazilian Portuguese.
- Decided 2026-11-05: functional setup (business questions, enrichment review, playbook creation) belongs in the app. Website signup keeps account details, company website, ticket volume and referral source only.
- Decided 2026-11-05: first value is the assistant answering a real customer question from the business's own website in a test chat, with the source shown.
- Decided 2026-11-05: ecommerce gets the deepest suggestions; other business types get solid, shorter defaults.
- Undecided: how signup answers reach core, and the exact readiness criteria for "set up".

## Evidence on Hand

- Positioning and capability claims: README.md.
- Replay reports deliberately have no headline percentage; do not invent one.
- No customer testimonials, onboarding benchmarks or activation numbers were provided. Do not fabricate them.

## Product Principles

1. Prove it works before asking for more. Reach a real answer from the customer's own content first.
2. Setup is never a wall. Every step can be skipped, left and resumed, and the next step is always visible.
3. Ask only what changes the outcome, and show what each answer changed. Never ask for what is already known.
4. Report real readiness. A step is done when the assistant can actually use it, not when a record exists.

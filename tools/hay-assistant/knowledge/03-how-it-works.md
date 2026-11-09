---
title: "Hay.chat: how it works"
type: guide
verified: 2026-11-09
sources:
  - hay-website src/how-it-works/en.locale.js
  - hay-website src/llms.njk (approvals and safety, channels)
  - hay-core README.md and CHANGELOG.md (0.1.0)
todo:
  - TODO(Roger) WhatsApp: the website how-it-works page says "coming soon" and llms.txt does not list it as a live channel, while the repo has a WhatsApp plugin (PR #101 pending per notes). Confirm status before telling anyone it is available.
---
# How Hay.chat works

Hay.chat follows a connect, train, act model.

## 1. Connect
- **Channels** where customers write. Live today per hay.chat/llms.txt: the web chat widget, email (the AI replies in the same thread), Instagram DMs, and Chatwoot (Hay.chat runs as an agent bot inside Chatwoot inboxes). Replies are in the shopper's language.
- **Data sources and actions**: Shopify, WooCommerce, Wix, Magento, Nuvemshop, Stripe, Zendesk, HubSpot and more. The agent gets real-time order, tracking and ticket data and can act.
- WhatsApp: not confirmed as available. Do not promise it; offer a call.

## 2. Train with your knowledge
- Upload PDFs, text, Word, PowerPoint, HTML, JSON or CSV files, write a document in the editor, or import a website (auto-crawl or sitemap). New content is searchable straight away, with no retraining step.
- Answers about your business are checked against your documents. If your documents cannot back an answer, the agent hands it to a person instead of guessing.

## 3. Shape the assistant
- One AI assistant per organization. You set its name, tone, instructions, greeting and what it should avoid in Settings > Assistant.
- **Playbooks** describe what to do in specific situations (refund requests, order status, and so on) in plain language. Type @ to pull in an integration action or a document.

## 4. Act, with guardrails
- The agent calls the store's own API to look up an order, refund, cancel, update an address and so on.
- Refunds, cancellations and discounts wait for a person's approval by default. An approval nobody acts on within 48 hours hands the conversation to your team. Optional reply approval (off by default) holds every AI reply for a person to approve, edit or block. A workspace that saved its own approval settings keeps them.
- Facts are checked in three stages before a reply is sent: claimed actions must match a tool that ran, invented products or policies are blocked, and claims are scored against your documents.
- The AI hands over to a person when the shopper asks, a tool fails, confidence is low, an action claim fails, a playbook step says so, or an approval expires. The person sees the whole conversation.
- Replies carry an AI label by default. In EU workspaces it cannot be hidden.
- Each AI message shows a confidence score in the dashboard. Any conversation can be exported as PDF, CSV or an evidence pack.

## 5. Review and improve
- Test a playbook draft before publishing; playbooks have version history with rollback.
- The Insights page groups ratings and conversations into issues; you can improve your knowledge from any conversation.

## Honest limits
No AI can promise it will never be wrong. Hay.chat is built to notice when it might be, and to hand over. No accuracy or resolution rate is published.

Sources: hay.chat/how-it-works, hay.chat/llms.txt, hay-core CHANGELOG 0.1.0.

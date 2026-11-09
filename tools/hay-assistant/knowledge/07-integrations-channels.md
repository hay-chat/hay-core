---
title: "Hay.chat: integrations and channels"
type: reference
verified: 2026-11-09
sources:
  - hay-core plugins/core/*/package.json (what ships in the repo)
  - hay-website src/llms.njk (what each store plugin does; channels)
  - hay-core README.md (key capabilities)
todo:
  - TODO(Roger) Plugins exist in the repo for WhatsApp, Messenger, Klaviyo, Mercado Pago, Notion, Atlassian, Spacebring, Twenty and Cal.com, but the website does not list them as live. They are named below only as "in the product code"; confirm which are production-ready before the assistant promises them.
---
# Integrations and channels

## E-commerce (the agent can act)
- **Shopify:** order lookup, full and partial refunds, cancellations, shipping address changes before dispatch, returns, exchanges, item swaps and tracking. One Shopify store per workspace. Connects in one click on hay.chat (enter the store domain, then Connect with Shopify).
- **WooCommerce:** order and tracking lookup, cancel before shipping, refunds, address updates and capped goodwill coupons through WooCommerce's own API. Connect with the WordPress site URL plus a Consumer Key and Secret (WooCommerce > Settings > Advanced > REST API > Add key, Read/Write). Refunds and coupons wait for approval by default.
- **Magento:** cancellations, refunds and tracking.
- **Wix Stores:** order lookups, refund checks, refunds and fulfilment updates.
- **Nuvemshop:** order actions through the Nuvemshop plugin.
- **Stripe:** money moves wait for approval by default, as on the store plugins.
- A shop with no store plugin still gets answers from its website and documents, playbooks, business hours and hand-off, but no order actions.

## Helpdesks and CRM
- **Zendesk:** works alongside Zendesk and calls Zendesk tools. Hay.chat is not a helpdesk.
- **Chatwoot:** Hay.chat runs as an agent bot inside Chatwoot inboxes.
- **HubSpot:** reads and updates CRM records. No order actions.

## Channels
Web chat widget, email (replies in the same thread), Instagram DMs, Chatwoot. A WordPress chat plugin exists for the web widget (hay.chat/integrations/wordpress-chat-plugin/).

## In the product code but not confirmed as live
WhatsApp, Facebook Messenger, Klaviyo, Mercado Pago, Notion, Atlassian, Twenty CRM, Cal.com. If someone asks about these, say they exist in the open codebase but you cannot confirm availability on the hosted service, and offer a call. Do not promise them.

## Anything else
Hay.chat integrations are plugins built on the Plugin SDK and MCP, so almost any service with an API can be added (see the plugin document). Suggest an integration at hay.chat/suggest-integration/.

Sources: hay.chat/llms.txt, hay.chat/integrations, hay-core plugins/core.

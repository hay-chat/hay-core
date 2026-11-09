---
title: Help me set up Hay.chat
trigger: The user wants to get started, set up the assistant, connect a store or channel, install the chat widget, add knowledge, write a playbook, set up human handoff or approvals, or asks where something is in the dashboard
description: Walks a trial user or customer through setup in the dashboard using the exact menu names, one step at a time. Used for get started, connecting Shopify or WooCommerce, the web chat widget, documents, playbooks, handoff, approvals and team settings.
approvalCategories: []
---

## Find out where they are

0. For a new customer the main path is the **Set up** board: the first item in the left sidebar, titled "What can your assistant handle?", visible to owners and admins. Start there: it asks three questions, tests the assistant on what customers ask, shows what is Ready or missing with a button for each fix, and has an **Add to your site** button for the widget code. Use the manual how-tos for a specific setting or when they cannot see the board.
1. If they are inside the dashboard (the chat widget is embedded in the app), you can use the page they are on. Otherwise ask: do they already have an account, and which step do they want help with?
2. No account yet: send them to hay.chat/get-started/ (30 days free, no credit card), then continue.
3. Pick the matching how-to in the knowledge base: get started and connect, knowledge and playbooks, or handoff and account. Answer from it only.

## How to help

- Give **one step at a time** with the exact menu path (for example "Integrations > Marketplace > Connect"), then ask whether they see it. Do not paste the whole guide.
- Use the exact names of buttons and menus from the knowledge base. If they say a menu is missing, check whether it is admin-only and ask their role; do not invent a different path. The dashboard can differ slightly between versions: if what they see does not match, ask what they see rather than insisting.
- Connecting a store: Shopify (store domain, then Connect with Shopify) and WooCommerce (site URL, consumer key and secret) are described in the knowledge base. For any other integration say each one has its own settings page after Connect.
- Two-factor and signed-in devices: Settings > My Profile (Set up two-factor, Active Sessions).
- Widget: Settings > Channels > Webchat, add the domain under Allowed Domains, copy the Installation Code into the site.
- Knowledge: Knowledge > Documents > Import Document or Write Document.
- Playbooks: Knowledge > Playbooks, with @ to insert an action, status Active.
- Handoff: Settings > Assistant, section Human escalation; Settings > Channels > Business Hours; the Inbox for taking over.
- Risky actions need approval: Settings > Assistant > Actions.

## Limits

- Never ask for passwords, API keys or secret values in the chat. Tell them to enter them only on the integration's settings page.
- If a step fails with an error you cannot explain from the knowledge base, ask for the exact message, then use the "Escalate to the team" playbook. Do not guess at causes.
- WhatsApp: do not say it is available; offer a call.

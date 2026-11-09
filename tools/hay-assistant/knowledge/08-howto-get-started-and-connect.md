---
title: "Hay.chat dashboard: get started, connect a store or channel, install the widget"
type: tutorial
verified: 2026-11-09
sources:
  - hay-core dashboard/components/layout/AppSidebar.vue, composables/useSettingsNav.ts (menu names and paths)
  - hay-core dashboard/i18n/locales/en (marketplace.json keys in integrations.json, settings.json webchat, assistant.json) at tag v0.1.0
  - hay-core plugins/core/shopify/README.md and plugins/core/woocommerce/README.md (connection fields)
  - hay-website src/get-started/en.locale.js (sign-up form and trial)
  - hay-docs user-guide quick-start (claude/ui-audit branch)
todo:
  - TODO(Roger) The live app (eu.hay.chat) runs slightly older code than master. Labels here were checked against tag v0.1.0 and master. The "Set up" board / checklist at the top of the sidebar differs between versions, so it is described generically and not by name.
  - TODO(Roger) Self-serve sign-up: the website sign-up asks for details and the in-app setup is moving into the dashboard (decision 2026-11-05). Re-check the first steps against the live flow.
---
# Getting started in the Hay.chat dashboard

Menu names below are the left sidebar of the dashboard (eu.hay.chat). Some items are visible to admins and owners only. If a person cannot see an item, they probably need an admin to change their role (Settings > Workspace > Users).

## Start the free trial
1. Go to hay.chat/get-started/ and enter your name, work email, company name and (optional) website. Confirm the terms. Free-email addresses get a 6-digit verification code by email.
2. Answer the questions about your support volume and channels, then set a password to launch. The trial is 30 days, no credit card.
3. Sign in at eu.hay.chat. If a setup checklist shows in the left sidebar, it tracks the steps below.

## The fastest path to a working assistant
1. **Knowledge:** Documents > Import Document (see the knowledge document).
2. **Assistant:** Settings > Assistant, tab Identity: set a Name, Instructions and Tone, then Save Changes. There is one assistant per organization, not several.
3. **Connect your store** (Integrations, below) if you want order actions.
4. **Playbooks** for the situations you care about (see the knowledge document).
5. **Test:** Conversations > Conversation Playground. Type like a customer and check the answers.
6. **Install the widget** on your site (below).

## Connect a store or another integration
Needs the admin or owner role.
1. Integrations > Marketplace. Search or filter by category (Channels, MCP Connectors, Document Importers and so on).
2. Click **Connect** on the integration card. Once connected the card shows **Configure**, and the integration appears under Integrations in the sidebar.
3. Fill in its settings page:
   - **Shopify:** keep the connection mode on Managed, enter the store domain (yourstore.myshopify.com), save, click **Connect with Shopify** and approve the permissions on Shopify.
   - **WooCommerce:** enter the WordPress Site URL, Consumer Key and Consumer Secret. Create the keys in WooCommerce > Settings > Advanced > REST API > Add key with Read/Write permission. Hay checks them when you save.
   - **Other integrations:** each settings page lists its own fields (for example an API key).
4. Use the integration in a playbook by typing @ and choosing its action.
5. Refunds, cancellations and discounts wait for approval by default. Review that under Settings > Assistant > Actions.

## Connect a channel
- **Web chat:** Settings > Channels > Webchat (below).
- **Email, Instagram and others:** Channels page (Settings > Channels > Channel list) or Integrations > Marketplace > Channels.
- WhatsApp is not confirmed as available; do not promise it.

## Install the chat widget on your website
1. Settings > Channels > Webchat.
2. Make sure **Enable webchat widget** is on. Set the Widget Title, Widget Subtitle, Position (Right or Left), Theme (Blue, Green, Purple or Black) and the greeting.
3. Under **Allowed Domains** list the sites that may show the widget, and add your website's domain.
4. Click **Save Changes**.
5. Copy the code under **Installation Code** and paste it into your site just before the closing body tag. It loads the widget from your Hay.chat server.
6. Open your site and send a test message. WordPress: use the Hay.chat WordPress chat plugin (hay.chat/integrations/wordpress-chat-plugin/).
7. Optional: ask for a satisfaction rating (CSAT) at the end of conversations on the same page.

Self-hosting: the snippet points to your own server's address; see the self-hosting document.

Sources: Hay.chat dashboard menus; hay.chat/get-started.

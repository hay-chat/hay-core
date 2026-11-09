---
title: "Hay.chat dashboard: get started, connect a store or channel, install the widget"
type: tutorial
verified: 2026-11-09
sources:
  - hay-core dashboard/components/layout/AppSidebar.vue, composables/useSettingsNav.ts (menu names and paths)
  - hay-docs user-guide setup.md, settings.md, quick-start.md (claude/ui-audit branch): Set up board labels
  - hay-core dashboard/i18n/locales/en (integrations.json marketplace keys, settings.json webchat, assistant.json)
  - hay-core plugins/core/shopify/README.md and plugins/core/woocommerce/README.md (connection fields)
  - hay-website src/get-started/en.locale.js (sign-up form and trial)
  - hay-docs user-guide quick-start (claude/ui-audit branch)
todo:
  - TODO(Roger) Production has the Set up board, two-factor and Active Sessions (confirmed by screenshots and the docs audit). Page tools in Settings > Channels > Webchat are not confirmed on production, so they are left out.
  - TODO(Roger) Self-serve sign-up: the website sign-up asks for details and the in-app setup is moving into the dashboard (decision 2026-11-05). Re-check the first steps against the live flow.
---
# Getting started in the Hay.chat dashboard

Menu names below are the left sidebar of the dashboard (eu.hay.chat). Some items are visible to admins and owners only. If a person cannot see an item, they probably need an admin to change their role (Settings > Workspace > Users).

## Start the free trial
1. Go to hay.chat/get-started/ and enter your name, work email, company name and (optional) website. Confirm the terms. Free-email addresses get a 6-digit verification code by email.
2. Answer the questions about your support volume and channels, then set a password to launch. The trial is 30 days, no credit card.
3. Sign in at eu.hay.chat. New workspaces that have not finished setup land on the **Set up** board.

## The Set up board (the main path for a new customer)
**Set up** is the first item in the left sidebar, with a progress badge such as 3/15 until it is finished. Only owners and admins can open it. It is titled **What can your assistant handle?**.
1. **Answer three questions** (or choose **Skip questions**): what kind of business this is (enter **Your website** and choose a **Business type**: Online store, Software or SaaS, Service provider, or Something else), what you already use (channels, store, payments, CRM, helpdesk, docs, bookings), and what customers ask most (edit the suggested questions or **Add a question customers ask**). Finish with **See what your assistant can do**.
2. **Read the board.** Each row is a customer request with a status and a button: **Ready** (Try it), **Missing answer** (Add answer: write the answer and Save answer), **Needs connection** (Connect or Choose platform), **Needs a playbook** (Write your own), **Playbook off** (Review, then Turn on), **Couldn't check** (Retry). A banner shows **Up next**, the single step that unlocks the most requests.
3. **Test your assistant** in the chat on the right. Nothing there reaches real customers. **Test on real conversations** (under the board, optional, not billed, with a monthly allowance) replays past conversations.
4. **Add it to your site:** click **Add to your site**, **Copy code**, and paste it into your site's HTML just before the page ends. It tells you how many requests are not ready yet; the assistant hands those to your team instead of guessing. **Appearance and more options** goes to Settings > Channels > Webchat. The **Where customers reach you** card lists channels as Connected or Not connected, each with a Connect button.
5. **Finish later** any time; come back from the sidebar (the **Setup progress** widget at the bottom links to **Continue setup**).

The sections below do the same things by hand, and are what to use when someone cannot see the board (wrong role) or wants a specific setting.

## The manual path
1. **Knowledge:** Knowledge > Documents > Import Document (see the knowledge document).
2. **Assistant:** Settings > Assistant, tab Identity: set a Name, Instructions and Tone, then Save Changes. There is one assistant per organization, not several.
3. **Connect your store** (below) if you want order actions.
4. **Playbooks** for the situations you care about.
5. **Test:** Conversations > Conversation Playground.
6. **Install the widget** (below).

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

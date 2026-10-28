# Meta App Review — Messenger (Hay.chat app 1869497150332050)

Drafted 2026-10-28. Roger submits; nothing here has been sent to Meta.

## Before submitting

- [x] Webhook `https://eu.hay.chat/v1/plugins/hay-channel-messenger-meta/webhook`, page fields `messages`, `message_echoes`
- [x] Valid OAuth redirect URI `https://eu.hay.chat/oauth/callback` (Facebook Login for Business → Settings)
- [x] Test calls made: Page "Magenta Terrários" connected to the demo org, a message received and answered (2026-10-28)
- [x] Privacy policy https://hay.chat/privacy-policy, terms https://hay.chat/terms-of-service, app icon, category
- [ ] **Reviewer login.** A Hay.chat account the reviewer can sign in with, in an org that already has an agent
      (create it yourself, don't reuse your own; put the credentials only in the "Notes for reviewer" field).
- [ ] **Screencast** (script below), English UI, ~2–3 min, 1080p. One video can cover all three permissions.
- [ ] Check the API-call counter for each permission turns green in App Review → Permissions and features (can take up to 24 h).

**Known gap (not a review blocker):** the app has ONE deauthorize URL and ONE data-deletion URL, and both
point at the WhatsApp plugin (`/v1/plugins/hay-channel-whatsapp-meta/...`). Core resolves the org by
looking the user id up in *that plugin's* routing keys only, so when someone removes Hay.chat from Facebook
the Messenger connection is not cleared (it logs "unknown routing key; nothing to remove"). Fix: one
shared Meta callback in core that clears every plugin instance whose routing keys contain that user id.

## Permission texts (paste into each "How will this app use…" field)

### pages_show_list

Hay.chat is a customer-support platform for small online shops. When a business clicks "Connect Messenger"
in the Hay.chat dashboard and signs in with Facebook, we call `GET /me/accounts` to list the Facebook Pages
that person manages and selected during login. We use the list only to connect those Pages to the
business's Hay.chat workspace and to show which Page is connected ("Connected as <Page name>"). We do not
store or display Pages the person did not select.

### pages_manage_metadata

After the business connects a Page, we call `POST /{page-id}/subscribed_apps` so that the Page's Messenger
messages are delivered to our webhook. Without this, Hay.chat cannot receive customers' messages. We
subscribe only to `messages` and `message_echoes`, and only for Pages the business connected. When the
business disconnects or removes the app, the subscription is no longer used.

### pages_messaging

Customers message the shop's Facebook Page. Hay.chat receives the message through the webhook, shows it in
the business's Hay.chat inbox, and answers with the business's AI support agent (order status, shipping,
returns, product questions), using the business's own store data and documents. Staff can read every
conversation and reply themselves from the inbox. All replies are sent with `POST /{page-id}/messages` as
responses to a message the customer sent, inside the 24-hour window. We never send promotional or
unsolicited messages and never message people who have not written to the Page first.

### Human Agent (feature)

A Hay.chat conversation can be handed from the AI to a person on the business's team, for example for a
refund, a complaint or a question the AI cannot answer. That person sometimes replies more than 24 hours
after the customer's last message (overnight, weekends). Only in that case, and only for a reply typed by a
human in the Hay.chat inbox, we resend it with the `HUMAN_AGENT` tag (within 7 days). AI-generated replies
never use the tag; if the window has closed, the AI does not reply.

## Notes for reviewer (field on the submission)

1. Sign in at https://eu.hay.chat with the credentials below.
2. Go to Integrations → Messenger and click "Connect to Messenger". Sign in with your test Facebook user and
   select a Page you manage. The card then shows "Connected as <Page>".
3. From another Facebook account, send that Page a Messenger message, e.g. "Hi, where is my order?".
4. In Hay.chat open Inbox: the conversation appears and the AI agent replies; the reply arrives in Messenger.
5. Click "Take over" on the conversation and type a reply: it is delivered as a human reply (Human Agent).

Login: <email> / <password>  (fill in when submitting; do not commit)

## Screencast script

1. (0:00) Hay.chat dashboard, signed in. Say/caption: "Hay.chat answers a shop's customer messages."
2. Integrations → Messenger → "Connect to Messenger". Show the Facebook dialog, the Page picker and the
   permissions list (**pages_show_list**). Confirm.
3. Back in Hay.chat: "Connected as <Page>". Caption: "The Page is subscribed to our webhook"
   (**pages_manage_metadata**).
4. Switch to a customer's Messenger (phone or browser), message the Page.
5. Back in the Hay.chat Inbox: the message appears, the AI answers; switch to Messenger to show the reply
   arriving (**pages_messaging**).
6. In the conversation click "Take over", type a reply, show it arriving in Messenger. Caption: "If a person
   answers after 24 hours, Hay.chat sends it with the Human Agent tag. The AI never does." (**Human Agent**)
7. Integrations → Messenger → Disconnect, to show the business can remove access.

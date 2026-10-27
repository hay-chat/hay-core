# WhatsApp Channel Plugin (Meta Cloud API)

Connects a WhatsApp Business number to Hay through **Meta's WhatsApp Cloud API**, with no
BSP in between. Customers' WhatsApp messages become Hay conversations. The agent's replies
go back to the WhatsApp chat. Meta bills the business directly for messages; Hay adds no fee.

- Plugin id / npm name: `hay-channel-whatsapp-meta`
- Channel slug: `whatsapp`
- Graph API: `v26.0` on `graph.facebook.com`
- Design and decisions: `.claude/plans/whatsapp-cloud/PLAN.md` (D1–D14)

## What it does

| Direction | Supported                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound   | Text, reply/list buttons, template quick replies, location, shared contacts, orders, ad/CTA openings (`request_welcome`), images, video, audio, documents and stickers. Media is re-hosted in Hay storage. Voice notes are transcribed by core so the agent can answer them. Reply context and click-to-WhatsApp ad referrals are kept in message metadata |
| Outbound  | Text (split at 4,096 characters) and attachments. Media is uploaded to `/{phone}/media` and sent by id; a single image, video or document carries the text as its caption                                                                                                                                                                                  |
| Statuses  | `sent` / `delivered` / `read` / `failed` (and voice `played`) update the Hay message by its `wamid`                                                                                                                                                                                                                                                        |
| Lifecycle | `account_update` `PARTNER_APP_UNINSTALLED` / `PARTNER_REMOVED` / `ACCOUNT_OFFBOARDED` and Graph error 190 disconnect the channel                                                                                                                                                                                                                           |

The settings page has three parts:

- **Connect**: runs Embedded Signup, or shows the manual-mode guide.
- **Health card**: number, display name, `health_status`, quality rating and messaging tier.
- **Payment card**: when the WhatsApp Business account has no payment method, links to its
  WhatsApp Manager page and re-checks when the user comes back.
- **Message templates card**: every template on the account with its status, category and
  Meta's rejection reason, plus a "Sync with Meta" button.

## Templates and the 24-hour window

- **Window (D13-2)**: each inbound message sends `replyWindowExpiresAt` (message time + 24 h)
  to `messages.receive`. Core stores it on the conversation; the composer shows when it
  closes, and once closed offers templates instead of free text.
- **Template store (D13-1)**: kept in the worker (one per org), synced from
  `GET /{waba}/message_templates` on start, on connect and from the settings page, and patched
  by `message_template_status_update` / `template_category_update` webhooks. `GET /templates`
  gives core the sendable ones (approved, body variables only); a restarted worker syncs again.
- **Human-picked templates (D13-3)**: core stores the message with `metadata.channelTemplate`
  `{name, language, parameters}`; `/deliver` sends it as a template. Human-started only, no
  automated sends.
- **Hand-off fallback (D13-4)**: when an AI hand-off message (`metadata.isHandoffMessage`) hits
  131047, `/deliver` sends the `handoffTemplateName` template (default `hay_handoff_to_person`)
  in the conversation's language, else English. Without an approved one, the window error stays.
- **Starter templates (D13-5)**: after a successful sync, missing `hay_we_replied` and
  `hay_handoff_to_person` (UTILITY, `en` + `pt_BR`) are submitted for Meta's review. Idempotent
  by name and language.

Customer identity (D3): `external_id` is `+<wa_id>` in E.164. Users who hide their number
behind a WhatsApp username have only a business-scoped user id, so they get
`whatsapp:bsuid:<user_id>` and are messaged with `recipient`.

Not yet: templates with media headers or variable button links, coexistence echoes and history
import (Phase 4), typing indicators and read receipts, interactive messages sent by the agent.

## Connecting a number

### 1. Embedded Signup (Hay Cloud and own-Tech-Provider deployments)

The org clicks **Connect WhatsApp** on the plugin's settings page:

1. The Facebook JS SDK opens Meta's Embedded Signup v4 popup (`config_id`,
   `response_type: "code"`). The SDK is loaded on click, and only on this page.
2. The customer logs in, verifies or picks a number, and picks or creates a business portfolio
   and a WhatsApp Business account. A number already in the WhatsApp Business app can stay
   there (coexistence).
3. The dashboard posts the 30-second code, plus the `waba_id` / `phone_number_id` the popup
   reported, to `plugins.oauth.completeWithCode`. Core exchanges the code with the app secret
   (which never reaches the worker) and stores the business token, which never expires.
4. `onConnected` checks the reported ids against the token: the number must be on that WABA.
   It then subscribes the app to the WABA's webhooks and registers the number with a random
   per-org PIN; coexistence numbers are already registered and are skipped. It returns
   `phone_number_id` and `waba_id` as routing keys and stores both ids and the PIN, encrypted,
   in the auth state.

Webhooks for every org arrive on one URL. Core verifies `X-Hub-Signature-256` with
`META_WHATSAPP_APP_SECRET` and answers the GET handshake with `META_VERIFY_TOKEN`. It routes each
`changes[]` item by `value.metadata.phone_number_id`, and account-level events by `entry[].id`.

```
https://<api-host>/v1/plugins/hay-channel-whatsapp-meta/webhook
```

### 2. Manual token (self-hosting, design partners before App Review)

No Hay `config_id`, App Review or Tech Provider status is needed. Your own Meta app is a
"Direct Integrator" for your own number.

1. Create a **Business** Meta app and add the **WhatsApp** product.
2. In Business Settings → System users, create a system user. Assign it the app and the
   WhatsApp Business account, then generate a token that **never expires** with
   `whatsapp_business_messaging` and `whatsapp_business_management`.
3. From WhatsApp → API Setup, copy the **Phone number ID** and the **WhatsApp Business Account
   ID**. Register the number there if it isn't registered yet.
4. In Hay, open the plugin settings, set **Connection method** to **Manual token** and fill in:
   - the token
   - both ids
   - your app secret (App settings → Basic)
   - a verify token of your choice

   Then save.

5. In your Meta app → WhatsApp → Configuration:
   1. Set the callback URL to the **per-org** URL shown on the settings page.
   2. Enter the same verify token.
   3. Subscribe the `messages` field (and `account_update` if you want disconnect events).

```
https://<api-host>/v1/plugins/hay-channel-whatsapp-meta/webhook?organizationId=<org-id>
```

On the per-org URL the worker answers the handshake with your verify token and verifies each
POST's signature with your app secret; unsigned or wrongly signed requests get a 403.

If your token comes from the app whose callback is already the shared URL (a self-hoster whose
`META_*` variables point at the same app, or Hay's own test number on Hay's app), keep the
shared URL. On start the worker checks that the token can see the number on that WABA, then
registers the phone number id and WABA id as routing keys through
`pluginApi.webhooks.setRoutingKeys`, so core routes those webhooks to your org.

## Environment (core process)

| Variable                     | Used for                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `META_WHATSAPP_APP_ID`       | Embedded Signup: `FB.init` app id and code exchange `client_id`                                         |
| `META_WHATSAPP_APP_SECRET`   | Embedded Signup: code exchange and shared-webhook signature checks. Core only, never sent to the worker |
| `META_VERIFY_TOKEN`          | Shared webhook GET handshake (core only)                                                                |
| `META_WHATSAPP_ES_CONFIG_ID` | Facebook Login for Business configuration of type "Embedded Signup" (v4)                                |
| `OPENAI_API_KEY`             | Voice-note transcription in core (`OPENAI_TRANSCRIPTION_MODEL`, default `gpt-4o-mini-transcribe`)       |

`META_VERIFY_TOKEN` is shared with the Instagram plugin. The app id and secret are **not**: Instagram
Business Login has its own Instagram app id/secret (`META_APP_ID` / `META_APP_SECRET`), while
WhatsApp webhooks are signed with, and Embedded Signup codes issued for, the Meta app itself
(App settings → Basic). Manual mode needs none of them.

### Running your own Tech Provider (self-hosted Embedded Signup)

Set `META_WHATSAPP_APP_ID`, `META_WHATSAPP_APP_SECRET`, `META_WHATSAPP_ES_CONFIG_ID` and
`META_VERIFY_TOKEN` for your own Meta app. In that app:

1. Add Facebook Login for Business and create a configuration with login variation
   **Embedded Signup** and product Cloud API. This puts it on v4. Set the token expiry to
   **never**.
2. Turn on **Login with JS SDK** and add your dashboard origin to the allowed domains. The
   popup needs https; for local testing, tunnel with ngrok or cloudflared and allow that
   origin.
3. Under WhatsApp → Configuration, set the shared callback URL above with `META_VERIFY_TOKEN`
   and subscribe these fields:
   - `messages`
   - `account_update`
   - `account_alerts`
   - `phone_number_quality_update`
   - `phone_number_name_update`
   - `message_template_status_update`
   - `template_category_update`
   - `business_capability_update`
   - `history`
   - `smb_app_state_sync`
   - `smb_message_echoes`
4. Point the Deauthorize and Data Deletion callbacks at
   `/v1/plugins/hay-channel-whatsapp-meta/deauthorize` and `/data-deletion`.
5. Complete Business Verification and App Review for `whatsapp_business_messaging` and
   `whatsapp_business_management`. Until then only app-role users can finish the popup, and
   Meta caps onboarding at 10 new businesses per 7 days.

## Billing and limits customers should know

- Meta bills the business's own WhatsApp Business account. Each number gets 1,000 free service
  messages a month. After that, and for every business-initiated template, Meta needs a payment
  method on file. The settings page links to the page in WhatsApp Manager where the business
  adds one.
- Free-form replies are allowed only within 24 hours of the customer's last message. Outside
  that window, delivery returns `24h_window_expired` and a person can send an approved template.
- Meta allows about 1 message per 6 seconds to the same user; above that it returns 131056.
  Delivery returns 503 (`rate_limited`) for 131056 and 130429. Core retries a 503 three times
  with backoff (5 s, 15 s, 45 s), then marks the reply failed and alerts owners and admins.

## Delivery error mapping (`POST /deliver`)

| Meta error                                      | Response                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| 131047 (outside the 24h window)                 | `200 {success:false, error:"24h_window_expired"}`                              |
| 131056, 130429, 80007, 4, 131057                | `503 rate_limited` (core retries)                                              |
| 5xx with a Graph error, connect-phase network   | `503 graph_unavailable` (core retries)                                         |
| bare 5xx, timeout or reset (may have been sent) | `200 {success:false, error:"delivery_uncertain"}` (never retried)              |
| 190 (token revoked)                             | `200 {success:false, error:"token_revoked"}`; Embedded Signup also disconnects |
| 133010 (number not registered)                  | `200 {success:false, error:"phone_not_registered"}`                            |
| 131026 (recipient unavailable)                  | `200 {success:false, error:"recipient_unavailable"}`                           |
| other 4xx                                       | `200 {success:false, error:"graph_<code>"}`                                    |

Once one message of a multi-part reply has been accepted, a later failure is logged and the
response is still a success, so a retry can't send the text twice.

## Development

```bash
cd plugins/core/whatsapp
npm test          # vitest: normaliser, media, signatures, onConnected, deliver mapping, status
npm run build     # UI bundle (dist/ui.js) + worker (dist/index.js)
```

To test against Meta's test number (`phone_number_id 976350592236691`), use manual mode with a
system-user token from Hay's app. Webhooks arrive on the shared URL and are routed by the keys
manual mode registers.

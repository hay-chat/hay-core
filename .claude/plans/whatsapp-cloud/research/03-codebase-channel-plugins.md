# Hay codebase: what exists for a native Meta WhatsApp Cloud API channel (2026-10-21)

**Short answer:** most plumbing already exists, built for Instagram (HAY-239): shared Meta app env vars, `register.webhookRouting` (core verifies HMAC, answers `hub.challenge`, routes by key to the right org), `onConnected` routing keys, OAuth with `authorizationParams`, `tokenExchange`/`tokenRefresh`, encrypted `authState`, `/deliver`, dedupe via `messages.receive`. The new plugin is a copy of `plugins/core/instagram` pointed at `graph.facebook.com`. Remaining work is WhatsApp-specific (Embedded Signup session info, templates, media, statuses, interactive) plus three core limits: one plugin per channel slug; inbound/outbound text-only; routing reads only `entry[].id`.

## 1. `plugins/core/whatsapp` (Twilio)

Manifest = `hay-plugin` block in `package.json`: npm `hay-channel-whatsapp-twilio`, category `channel`, `channel: "whatsapp"`, capabilities `messages`,`customers`, env `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`.

| File                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts:13-188`                   | `defineHayPlugin`. `register.config` (accountSid, authToken `encrypted:true`, whatsappNumber, env fallbacks) `:30`. `register.auth.apiKey` `:59`. `register.ui.page` slot `after-settings` `:66`. `register.route("POST","/webhook")` `:75`, `("POST","/deliver")` `:83`. `onValidateAuth` `:94`. `onStart`/`onConfigUpdate` rebuild Twilio client in closures `:134`,`:160`. |
| `src/webhook.ts:20-100`                 | Validates `x-twilio-signature` against `x-original-url` + re-encoded body `:38-51`. Reads `From/Body/ProfileName/WaId/MessageSid`, strips `whatsapp:`, calls `messages.receive({from: <bare E.164>, content, channel:"whatsapp", metadata:{profileName, waId, messageSid}})` `:72`. No `mid` → no dedupe. Media-only → 400.                                                   |
| `src/signature.ts:16`                   | `validateTwilioSignature`.                                                                                                                                                                                                                                                                                                                                                    |
| `src/deliver.ts:30-100`                 | `client.messages.create({from,to,body})` text only. Twilio `63016` → `200 {success:false, error:"24h_window_expired"}` `:78`. Returns `providerMessageId: sid`.                                                                                                                                                                                                               |
| `src/plugin-api.ts:10-59`               | `PluginApiClient.mutation()` tRPC over HTTP to `${HAY_API_URL}/v1/pluginApi.<proc>` with Bearer `HAY_API_TOKEN`. Duplicated per channel plugin.                                                                                                                                                                                                                               |
| `components/settings/AfterSettings.vue` | Twilio setup guide; per-org webhook URL `/v1/plugins/<id>/webhook?organizationId=<org>` `:173-178`.                                                                                                                                                                                                                                                                           |
| `i18n/en.json`, `i18n/pt-BR.json`       | Labels.                                                                                                                                                                                                                                                                                                                                                                       |

Not present: media, status callbacks, templates, interactive, typing, tests.

## 2. `plugins/core/instagram` (shared Meta app)

- Manifest: `hay-channel-instagram-meta`, `channel:"instagram"`, env `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`.
- Config: hidden `clientId`/`clientSecret` filled from env (`src/index.ts:47-64`). Nothing for the org to type.
- OAuth (`src/index.ts:72-96`): Instagram Business Login (`instagram.com/oauth/authorize`, `api.instagram.com/oauth/access_token`), scopes `instagram_business_basic,instagram_business_manage_messages`, `scopeSeparator:","`. `tokenExchange` → long-lived (`ig_exchange_token`), `tokenRefresh` (`ig_refresh_token`). No page picker.
- `register.webhookRouting` (`src/index.ts:103-129`): header `x-hub-signature-256`, `sha256-hmac`, secret `META_APP_SECRET`; handshake `hub.mode/hub.verify_token/hub.challenge` with `META_VERIFY_TOKEN`; routing key `routeKeyPath {itemsPath:"entry", keyPath:"id"}`; deauthorize + data deletion via `signed_request`, key `user_id`.
- `onConnected` (`src/index.ts:235-279`): swaps token in worker, `POST /me/subscribed_apps`, returns `{routingKeys:[id,user_id], account:{label,avatarUrl}}`. `onStart` re-subscribes `:205`.
- `src/webhook.ts:95-226`: requires `x-hay-webhook-verified: true`; accepts `entry.messaging[]` and `entry.changes[].value`; ignores echoes/postbacks/reactions/attachment-only; `messages.receive({from:"instagram:<psid>", channel, senderType:"customer", metadata:{mid, username, profileName, igAccountId}})` — `mid` enables core dedupe.
- `src/deliver.ts:54-141`: strips `instagram:`, `sendText`; 24h error (subcode 2534022 / code 10) → `200 {success:false,"24h_window_expired"}`; other 4xx → `200 {success:false,"graph_<status>"}`; network/5xx → 500.
- `src/graph-client.ts`: `GraphClient` on `graph.instagram.com/v21.0`; `request()` with typed `GraphApiError(status, code, subcode)` `:32`; `getProfile`, `sendText`, `subscribeToWebhooks`, `getConnectedAccount`. **Copy this, point at `graph.facebook.com`.**
- `AfterSettings.vue` + `i18n/en.json`: 4-step guide (en step 1 text is stale).

### Core primitives behind it

- `server/main.ts:136-141` body-parser `verify` keeps `req.rawBody`; `server.use("/v1/plugins", proxy)` `:272`.
- `server/routes/v1/plugins/proxy.ts:20` `ALL /v1/plugins/:pluginId/*`: `/webhook` without `organizationId` → `webhookRouterService.handle` `:33`; `/deauthorize`, `/data-deletion` `:43`; else forward to per-org worker with `x-original-url`, `x-original-body-base64` `:127-135`.
- `server/services/webhook-router.service.ts`: `getRoutingDescriptor` `:57`; `handle` `:87` (GET → `handleVerification` `:256`; POST verifies HMAC over raw bytes, 200 immediately, `dispatch` in background); `dispatch` `:306` uses `getPath(item, keyPath)`, `pluginWebhookRouteRepository.findByKey`, groups by org; `forwardToOrg` `:374` rebuilds body with only that org's `entry[]`, POSTs to worker `/webhook` with `x-hay-webhook-verified`; `handleDeauthorization` `:163`. Tests: `server/tests/services/webhook-router.service.test.ts`.
- Routing table `plugin_webhook_routes`, unique `(plugin_id, routing_key)` — latest connect wins (`server/database/migrations/1782000000002-AddPluginWebhookRoutes.ts`). Repo: `server/repositories/plugin-webhook-route.repository.ts` (`upsertRoutes`, `findByKey`, `clearForInstance`).
- `server/services/oauth.service.ts`: `initiateOAuth` `:136` (applies `authorizationParams`, `scopeSeparator` `:276-304`); `handleCallback` `:336` → `exchangeCodeForTokens` `:601` → `performTokenOp` `:572` (`tokenExchange` `:489`); `storeTokens` `:685`; `runOnConnected` `:761` (calls worker `/on-connected`, stores keys + account); `getConnectionStatus` `:860`; `refreshToken` `:906`; `revokeOAuth` `:837`.
- `server/services/oauth-token-refresh.job.ts` every 10 min for tokens expiring within 15 min.
- Status UI: `dashboard/components/plugins/PluginOAuthConnection.vue`, `dashboard/pages/integrations/plugins/[pluginId].vue`.

## 3. Plugin SDK contract (`packages/plugin-sdk`)

- Register API `types/register.ts:107-270`: `route`, `config`, `ui.page`, `auth.apiKey|auth.oauth2`, `cron`, `webhookRouting`. No `register.channel` — channel declared by `hay-plugin.channel` in package.json. `trpcRouter` only for document importers.
- Webhook routing types `types/webhook-routing.ts:29-133`. OAuth types `types/auth.ts:109-221` (`authorizationParams`, `scopeSeparator`, `tokenExchange`, `tokenRefresh`, `OAuthTokenOp` runs as GET).
- Hooks `types/hooks.ts`: `onInitialize`, `onStart`, `onValidateAuth`, `onConfigUpdate`, `onDisable`, `onConnected` → `{routingKeys?, account?}` `:94-105`.
- Runner `runner/http-server.ts`: `/health`, `/metadata`, `/validate-auth`, `/on-connected` `:319`, `/config-update`, `/disable`, `/cron/:name`, `/mcp/*`, plugin routes.
- Credentials: `authState` encrypted by `AuthStateEncryptedTransformer` (`server/entities/plugin-instance.entity.ts:29-35`); config `encrypted:true` stored encrypted; workers get `HAY_ORG_CONFIG`, `HAY_ORG_AUTH`. Manifest `env` allowlist filtered by `DENIED_ENV_PATTERNS` (`server/services/plugin-runner.service.ts:457-475`, blocks `/SECRET/`, `/TOKEN/`) → **`META_APP_SECRET` and `META_VERIFY_TOKEN` never reach the worker**; anything needing the app secret (`appsecret_proof`, `debug_token`, code exchange) must run in core.
- Inbound `server/routes/v1/plugin-api/trpc.ts:89` `messages.receive({from, content:string, channel, metadata?, senderType?, externalConversationId?})`: find/create customer by `external_id=from`; `metadata.profileName`/`metadata.phone` saved to customer; everything into `external_metadata[channel]`; agent for channel `:931`; find/create conversation; dedupe Redis SETNX `dedupe:msg:org:channel:mid` `:884-915`. Also `messages.send` `:292` (proactive), `conversations.updateStatusByExternalId`, `customers.upsert`, `customers.findByExternalId`.
- Outbound `server/services/channel-delivery.service.ts`: subscribes Redis `websocket:events`; handles `BotAgent`/`HumanAgent` messages with `deliveryState==="sent"` and no `externalOrigin`; `findPluginIdByChannel` (`plugin-manager.service.ts:971`); POST `/deliver` `{to: customer.external_id, content, messageId, conversationId, conversationMetadata, messageMetadata}` `:302` → `{success, providerMessageId?, error?}` → `updateProviderMessageId`. `/escalate` on `pending-human`. **No attachments, typing or read-receipt hooks**, though `Message.attachments` jsonb `{id,name,url,type,size}` exists (`server/database/entities/message.entity.ts:163`) and `server/services/storage.service.ts` (`upload`/`download`) exists unused by channels.

## 4. Existing Cloud API references

Only two old plans: `.claude/plans/WHATSAPP_INTEGRATION_ROADMAP.md` ("PAUSED Feb 2026, went with Twilio"; Tech Provider plan, customer-owned WABA) and `.claude/plans/WHATSAPP_INTEGRATION_STRATEGY.md` (ES sketch: scopes, `debug_token` granular_scopes, `/{waba}/subscribed_apps`, v18.0). No code handles `waba`, `phone_number_id` or ES.

## 5. Channel archetype rules (`.claude/skills/build-plugin/`, `docs/technical/plugins/channel-registration.md`, `channel-architecture.md`)

1. `category:"channel"`, unique `channel` slug, capabilities `messages`,`customers`; npm name `hay-channel-<name>-<provider>`.
2. Channels are declarative; no runtime registration.
3. One plugin per slug (`findPluginIdByChannel` returns first match); `web` reserved.
4. Inbound `POST /webhook`: verify signature over raw bytes (chatwoot plugin is the model: timing-safe + replay window), filter, `messages.receive`.
5. Channel-scoped `from` (e.g. `instagram:<psid>`), always pass `metadata.mid`.
6. Outbound `POST /deliver` → `{success, providerMessageId}`.
7. Permanent provider errors → `200 {success:false}`; transient → 5xx.
8. `/escalate` optional.
9. Provider clients in closures (`onStart`/`onConfigUpdate`/`onConnected`; null in `onDisable`).
10. Copy `PluginApiClient` (no SDK export yet).

## 6. Gaps for a Meta Cloud API channel

1. **Slug conflict**: both plugins would declare `channel:"whatsapp"`. New slug, or per-org resolution in `findPluginIdByChannel`. Twilio customers use bare E.164 `external_id`; a different identity format would duplicate customers.
2. **Routing depth**: `routeKeyPath` reads one level (`entry[].id` = WABA id). `phone_number_id` lives at `entry[].changes[].value.metadata.phone_number_id` → needs nested path support + per-org filtering of `changes`.
3. **Embedded Signup**: OAuth flow is redirect-only; no JS SDK popup; no capture of `WA_EMBEDDED_SIGNUP` sessionInfo; code exchange needs app secret (core); no `/register` PIN; `subscribed_apps` easy in `onConnected`.
4. **Token model**: business token never expires, no refresh → omit `tokenRefresh`; no health check catches revocation. `revokeOAuth` (`oauth.service.ts:837`) **does not clear `plugin_webhook_routes`** nor stop the worker.
5. **Templates / 24h**: nothing. Core only logs `24h_window_expired`.
6. **Media**: `messages.receive` has no attachments; `/deliver` sends none; no download/re-host/upload.
7. **Statuses**: no inbound path for `statuses[]` → message status by `provider_message_id`; no read receipts / typing.
8. **Interactive/reactions/location/contacts/context/referral**: unmodeled.
9. **App Review artifacts**: deauthorize/data-deletion endpoints exist (generic). Pricing/category tracking absent.
10. **Tests**: neither channel plugin has tests; only core webhook router is tested.

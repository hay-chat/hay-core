# Per-channel agent routing (many-to-many)

## Goal / acceptance criteria

- An agent can be assigned to multiple channels; a channel can list multiple agents (M2M).
- At runtime each incoming message still resolves to exactly ONE agent for its channel.
- Agent settings page shows a "Channels" card listing the org's enabled channels (incl. built-in Web Chat) as toggles.
- The Channels card is hidden when the org has zero enabled channels.
- `channelAgents` org-setting scaffolding removed (alpha, no back-compat).

## Data model decision

- Add `channels: string[]` (text[] , default `{}`) to Agent. This IS many-to-many: a channel id can appear on many agents, an agent can have many channels.
- Channel ids are the canonical `manifest.channel` strings (e.g. "instagram") + built-in "web".

## Runtime resolution (temporary rule, documented as TODO)

For a given channel, `getAgentForChannel`:

1. Agents whose `channels` include the channel -> if multiple, prefer org default agent if among them, else deterministic (earliest created_at).
2. Else org `defaultAgentId`.
3. Else first agent.

## Tasks

- [ ] Agent entity: add `channels` text[] column
- [ ] Migration: add `channels` to agent
- [ ] Remove `channelAgents` from organization-settings.types.ts (+ doc migration ref)
- [ ] Rewrite `getAgentForChannel` (plugin-api/trpc.ts) to use agent.channels
- [ ] agents create/update routes: accept `channels: string[]`
- [ ] New tRPC procedure: list org enabled channels (id, name, thumbnail) incl. Web Chat
- [ ] Dashboard: Channels card on agents/[id].vue bound to agent.channels; hidden when no channels
- [ ] Regenerate tRPC types
- [ ] Verify: typecheck server + dashboard; manual routing check

## Results

- Agent entity: added `channels text[]` (migration 1782000000004, applied).
- Removed `channelAgents` from organization-settings types; rewrote `getAgentForChannel`
  to resolve via `agent.channels` (assigned → prefer default → earliest; else org default; else first).
- agents create/update accept `channels: string[]`; service passes through.
- `plugins.getAll` now returns `channel` (manifest.channel) per plugin.
- agents/[id].vue: "Channels" card (switches for Web Chat + enabled channel plugins),
  hidden when org has zero channels; bound to `form.channels`.
- Verified: server typecheck clean; dashboard typecheck clean for agents page
  (4 pre-existing unrelated errors in conversations/customers remain). Migration applied OK.

## Working notes

- channelAgents was unused scaffolding (types + getAgentForChannel + doc-only migration 1764863000000).
- Enabled channel plugins: filter plugins by `enabled && type.includes("channel")`; channel id from manifest.channel (not currently surfaced by getAll - must add).
- Web Chat / "web" is always-on built-in (no plugin instance).

---

# CSAT (Customer Satisfaction) Feature for Webchat

## Goal

Add a 1–5 emoji satisfaction rating to the webchat widget, shown when a
conversation ends. The prompt text ("How would you rate the support you
received today?") is customizable from the dashboard webchat settings page,
and rating + enabled flag are stored per-organization.

## Acceptance Criteria

- [ ] Widget shows a 1–5 emoji rating prompt when a conversation is closed/resolved (if CSAT enabled)
- [ ] Default question text matches the requested copy and is customizable
- [ ] Dashboard webchat settings page has a CSAT section (enable toggle + question)
- [ ] Rating persists to the backend (per conversation) via DPoP-authenticated public endpoint
- [ ] After submitting, the widget shows a thank-you state
- [ ] typecheck + build pass for server, dashboard, webchat

## Plan

### Backend

- [ ] webchat_settings entity: add `csatEnabled` (bool, default true), `csatQuestion` (text, default copy)
- [ ] conversation entity: add `csat_rating` (smallint, nullable), `csat_rated_at` (timestamptz, nullable)
- [ ] Migration adding the 4 columns
- [ ] webchat router: include csat fields in updateSettings input + getPublicConfig output
- [ ] webchat-settings service: DTO + getPublicConfig return
- [ ] public-conversations router: add `submitCsat` mutation (DPoP verified)

### Widget

- [ ] HayChatConfig: add csatEnabled, csatQuestion
- [ ] Widget.vue: fetch csat fields from public config, pass down
- [ ] CsatRating.vue: new component (emoji scale + thank-you)
- [ ] useConversation.ts: submitCsat HTTP call
- [ ] useChat.ts: submitCsat action + csatSubmitted state (reset on new conversation)
- [ ] ChatWindow.vue: render CsatRating in closed footer
- [ ] i18n: csat.thankYou + csat.defaultQuestion across locales

### Dashboard

- [ ] webchat.vue: CSAT card (toggle + question), wire load/save
- [ ] settings i18n (en + pt-BR): csat strings
- [ ] regenerate tRPC types

## Results

- Backend: added `csatEnabled`/`csatQuestion` to `webchat_settings`; `csat_rating`/`csat_rated_at`
  to `conversations`; migration `1781300000000-AddCsatToWebchat`. Public endpoint
  `publicConversations.submitCsat` (DPoP-verified). `getPublicConfig` and `getMessages` now expose
  the CSAT config / existing rating.
- Widget: new `CsatRating.vue` (1–5 emoji scale + thank-you), shown in the closed-conversation
  footer when enabled. `useChat.submitCsat` posts via DPoP with NONCE_EXPIRED retry; already-rated
  conversations show the thank-you state. CSAT i18n added to all 13 locales.
- Dashboard: new CSAT card on the webchat settings page (enable toggle + question textarea), wired
  through load/save. en + pt-BR strings added.
- Verified: server typecheck PASS, dashboard typecheck PASS (exit 0), webchat build PASS and typecheck
  clean (only pre-existing unrelated `fake-indexeddb` test-setup error remains).

## Working Notes

- Closure detection already exists (isConversationClosed). CSAT slots into the closed footer in ChatWindow.
- Public submission reuses the DPoP proof pattern from sendMessage (NONCE_EXPIRED retry).
- Latest migration timestamp: 1781200000000 -> use 1781300000000.
- Rating stored as columns on conversation (one per conversation) — minimal, no new table.

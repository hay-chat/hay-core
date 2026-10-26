# Mobile: attention-first Home, responsive dashboard, push alerts (branch claude/mobile-attention)

Source: `tasks/prospect-faq-answers-2026-10-26.md` §11 Mobile (+ "Fix or stop claiming" #8 "works on phones").

## Goal
A merchant on a phone opens hay.chat and, within one screen, sees which conversations are waiting for a
human, takes one over with a single tap, and gets a push notification on that phone when a new one
appears, even with no dashboard tab open. Everything else (metrics, charts) is secondary.

## Acceptance criteria
- `/` (Home) lists pending-human conversations (longest wait first) with summary + wait time and a
  one-tap **Take over** that assigns to me and opens the conversation; "You're handling" section below;
  live-updates over WebSocket; honest empty state. Metrics dashboard stays at `/dashboard`.
- Dashboard usable at 360px: sidebar becomes a top bar + drawer; conversation detail has no fixed
  `w-80` panel (details open in a sheet), composer and Take over reachable by thumb; conversation list
  does not overflow.
- Web Push: `push_subscriptions` table + migration; VAPID config (feature off when unset);
  `notifications.{pushPublicKey,subscribePush,unsubscribePush,sendTestPush}`; a push is sent to every
  subscribed device in the org whenever a conversation enters `pending-human`; dead subscriptions
  (404/410) are removed. Dashboard: service worker, installable manifest, "Alerts on this device"
  toggle on Home + Profile, notification click opens the conversation.
- i18n en + pt-BR for every new string. Docs user-guide updated; website lines listed in PR.

## Checklist
- [x] Plan + worktree `claude/mobile-attention` (.claude/worktrees/mobile-attention)
- [x] Server: web-push dep, VAPID config, PushSubscription entity + migration, push service, router
- [x] Server: Jest unit test for push service (fan-out, prune 410, unconfigured no-op, trigger on pending-human)
- [x] Dashboard: sw.js + manifest + head meta; usePushNotifications composable
- [x] Dashboard: layout mobile top bar + drawer (Sheet) ; Page header wraps
- [x] Dashboard: Home page at `/` (attention inbox) + nav ("Home" first); auth redirects to `/`
- [x] Dashboard: conversation detail responsive (header, panel → sheet, composer); list responsive
- [x] Dashboard: Profile "Notifications on this device" card
- [x] i18n en + pt-BR
- [x] Verify: `npm run typecheck`, `npm run lint`, `npm run test:server` (output recorded below)
- [x] Verify: impeccable detect on changed UI; Playwright `tests/mobile-home-attention.spec.ts` (phone viewport)
- [x] Independent reviewer agent on `git diff master...HEAD`; address findings
- [x] Docs: docs/user-guide (faq "works on phones", conversations/dashboard) ; website lines list
- [x] WIP.md + CONTEXT.md + lessons; push; PR

## Working notes
- Entities live in BOTH `server/entities/*` (index.ts) and `server/database/entities/*`; data-source lists them explicitly.
- pending-human is set via `conversationRepository.update/updateById` (orchestrator handoff + release-to-queue), which
  already call `conversationEventsService.broadcastConversationUpdated(conv, changedFields)` → hook push there (before the
  Redis-connected check, so push works without Redis).
- WS service targets org, not user. Push subscriptions store organization_id at subscribe time (active org).
- Dashboard has no unit-test runner (no vitest config); dashboard coverage = Playwright.
- Ports 3000/3001 on this host belong to other apps (coolify containers / a next-server). E2E needs alternate ports.
- Old `/dashboard` metrics page unchanged; Home is new `pages/index.vue`.

## Reviewer outcome

Independent reviewer ran on `git diff master...HEAD`; 31 findings. Addressed: onboarding redirect restored on Home; push hook moved to
`conversationRepository` with a real transition check (fire-and-forget); `subscribe` upserts on endpoint; fan-out joins active
`user_organizations`; `removeForMember` on member removal; `sendTest` uses org locale; `attention` tRPC procedure replaces the
client-side list filtering; layout owns count/plugin fetches and refreshes the badge on all conversation events; push `sync` gated by
a localStorage org marker + VAPID key-rotation check; `Input type="switch"`; blocked/unsupported affordance; sw.js origin guard +
openWindow fallback; details Sheet closes at ≥lg; `getHandoffWaitClass` util; unused exports removed; spec Chromium-only + cleanup
on failure; `.impeccable/` ignored; `.env.example` VAPID_SUBJECT empty. Disagreed/deferred: none blocking; maskable PWA icon set and
per-user notification preferences left as follow-ups (noted in CONTEXT.md).

## Results

- Server: `npx tsc --noEmit` clean; `npx jest tests/services/push-notification.service.test.ts` 11/11 passed.
- Dashboard: `npx nuxi typecheck` clean (exit 0).
- Lint: `npx eslint "server/**/*.{js,ts}" "dashboard/**/*.{js,ts,vue}" --cache --max-warnings 0` clean.
- Impeccable detect on changed UI files: no findings (`[]`).
- Playwright: `tests/mobile-home-attention.spec.ts --project=chromium` 2 passed (Pixel 7 emulation; alt-port stack with
  `E2E_BASE_URL=http://localhost:3100`, browser server in docker via `PW_TEST_CONNECT_WS_ENDPOINT`). The shared auth helper was
  broken (`pinia:auth` keys, org list nested under `user`), fixed in `tests/helpers/auth.ts`.
- Docs: hay-docs branch `claude/mobile-attention` (faq, dashboard, conversations, troubleshooting).

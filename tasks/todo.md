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
- [ ] Server: web-push dep, VAPID config, PushSubscription entity + migration, push service, router
- [ ] Server: Jest unit test for push service (fan-out, prune 410, unconfigured no-op, trigger on pending-human)
- [ ] Dashboard: sw.js + manifest + head meta; usePushNotifications composable
- [ ] Dashboard: layout mobile top bar + drawer (Sheet) ; Page header wraps
- [ ] Dashboard: Home page at `/` (attention inbox) + nav ("Home" first); auth redirects to `/`
- [ ] Dashboard: conversation detail responsive (header, panel → sheet, composer); list responsive
- [ ] Dashboard: Profile "Notifications on this device" card
- [ ] i18n en + pt-BR
- [ ] Verify: `npm run typecheck`, `npm run lint`, `npm run test:server` (output recorded below)
- [ ] Verify: impeccable detect on changed UI; Playwright `tests/mobile-home-attention.spec.ts` (phone viewport)
- [ ] Independent reviewer agent on `git diff master...HEAD`; address findings
- [ ] Docs: docs/user-guide (faq "works on phones", conversations/dashboard) ; website lines list
- [ ] WIP.md + CONTEXT.md + lessons; push; PR

## Working notes
- Entities live in BOTH `server/entities/*` (index.ts) and `server/database/entities/*`; data-source lists them explicitly.
- pending-human is set via `conversationRepository.update/updateById` (orchestrator handoff + release-to-queue), which
  already call `conversationEventsService.broadcastConversationUpdated(conv, changedFields)` → hook push there (before the
  Redis-connected check, so push works without Redis).
- WS service targets org, not user. Push subscriptions store organization_id at subscribe time (active org).
- Dashboard has no unit-test runner (no vitest config); dashboard coverage = Playwright.
- Ports 3000/3001 on this host belong to other apps (coolify containers / a next-server). E2E needs alternate ports.
- Old `/dashboard` metrics page unchanged; Home is new `pages/index.vue`.

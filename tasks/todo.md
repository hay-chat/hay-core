# Billing lock — core side (branch claude/billing-lock)

Plan: /home/home/.claude/plans/vast-munching-brooks.md (Part B). Backoffice + website work happens in
/srv/hay/wt-billing-lock and /srv/hay/wt-website-billing on the same branch name.

## Checklist

- [x] B1 entity columns + migration 1784300000000-AddOrganizationSuspension (timestamp follows the latest existing migration, not the plan's 1782…)
- [x] B2 INTERNAL_API_SECRET, internalProcedure, internal.organizations.{setAccessState,getAccessState,delete}
- [x] B3 errorFormatter, suspension middleware in isAuthed, apiKeyAuth, orchestrator run.ts early return, webchat getPublicConfig {enabled:false} + widget hides
- [x] B4 auth.me/switchOrganization expose fields, store getters, errorLink detection, auth.global redirect/lock, useExternalLink, pages/suspended.vue, AccessNoticeBanner, i18n en+pt-BR
- [x] B5 Jest tests (internal-auth, suspension, internal router, orchestrator skip) + webchat vitest
- [x] Verify: npm run typecheck, npm run lint, server + dashboard + webchat tests
- [ ] WIP.md + CONTEXT.md checkpoint

## Contract deviations
- None in names/shapes. Two additions the other sides may use: `setAccessState` also returns `suspensionRedirectUrl`, and the WebSocket event `organization_access_changed` carries the same state object.
- Migration file is `1784300000000-AddOrganizationSuspension.ts` (the plan said 1782…; TypeORM orders by timestamp and 1784200000000 already exists).

## Contract (shared with backoffice/website — do not drift)

- Header `x-hay-internal-secret` == core env `INTERNAL_API_SECRET` (backoffice env `HAY_INTERNAL_API_SECRET`). Empty → internal.\* returns FORBIDDEN.
- `internal.organizations.setAccessState({ organizationId: uuid, suspension: { reason: "trial_expired"|"payment_failed"|"cancelled"|"manual", redirectUrl?: url } | null, notice: AccessNotice | null })`
  → `{ suspendedAt, suspensionReason, suspensionRedirectUrl, accessNotice }`. Idempotent; keeps original suspendedAt.
- `internal.organizations.getAccessState({ organizationId })` → same shape.
- `internal.organizations.delete({ organizationId })` → `{ success: true }` (reuses organizations.delete logic).
- `AccessNotice = { key: string; level: "info"|"warning"|"critical"; params?: Record<string,string|number>; text?: string; ctaUrl?: string; ctaLabel?: string; expiresAt?: ISO }`.
  Dashboard i18n keys the backoffice will use: `accessNotice.trial_ending` {date, daysLeft}, `accessNotice.payment_failed` {lockDate}.
- Suspended + redirectUrl + owner/admin → dashboard does `auth.generateAuthCode` and navigates to `redirectUrl?code=<code>&reason=<reason>` (same tab). Otherwise `/suspended` page.
- Suspended tRPC calls fail with FORBIDDEN, `data.type = "ORGANIZATION_SUSPENDED"`, `data.reason`. Exempt: `auth.*`, `internal.*`, `organizations.switchOrganization`, `organizations.getSettings`, `organizations.delete`, `plugins.getMenuItems`.
- `webchat.getPublicConfig` returns `{ enabled: false }` (no throw) when webchat disabled or org suspended; widget renders nothing.

## Working notes

- Organization entity is already on `ctx.user.userOrganization.organization` (loadUserOrganization relations: ["organization"]) → no extra query in middleware.
- `runConversation()` in server/orchestrator/run.ts is the single funnel; `findById` joins organization. Must clear needs_processing or the 30s sweep re-enqueues forever.
- tRPC `cause` is not serialized → errorFormatter in server/trpc/init.ts.
- Dashboard logout heuristic in utils/api.ts matches "unauthorized" in messages → keep suspension message free of it.

## Results (core, branch claude/billing-lock)
Commits: da2b409 (server), d40809b (dashboard + widget), 82457dd (tests).
- Server: `types/organization-access.types.ts`, 4 new org columns + migration, `trpc/middleware/internal.ts` (`x-hay-internal-secret`, INTERNAL_API_SECRET), `routes/v1/internal` (setAccessState/getAccessState/delete), `trpc/middleware/suspension.ts` wired into `isAuthed`, errorFormatter exposes `data.type/reason`, apiKeyAuth rejects suspended orgs, `runConversation` early return, `webchat.getPublicConfig` → `{enabled:false}`, `organizationService.deleteWithData` shared by owner + internal delete, auth.me/switchOrganization expose the access state.
- Dashboard: `composables/useExternalLink.ts`, `composables/useSuspension.ts`, `pages/suspended.vue`, `components/AccessNoticeBanner.vue`, store fields/getters/actions, errorLink + auth.global redirect-or-lock, WS `organization_access_changed`, i18n en/pt-BR `access.json`.
- Webchat: widget hides on `enabled:false` (+ `@vue/test-utils` devDep, `src/__tests__/Widget.spec.ts`).
- Verified: `npm run lint` clean, `npm run typecheck` (plugin-sdk, server-sdk, dashboard, server) clean, server jest 44/49 suites green — the 5 failing suites are DB integration tests that need a Postgres (`Driver not Connected`; the worktree has no .env — main repo resolves /srv/hay-core/.env four levels up), webchat vitest 15/15.
- Not done: migration not executed anywhere yet (no local DB); runs on prod boot. `.env` for INTERNAL_API_SECRET not set in /srv/hay-core/.env.

# Agent pause switch (branch claude/agent-pause, worktree .claude/worktrees/claude+agent-pause)

Slice 3 of `tasks/prospect-faq-answers-2026-10-26.md` §13 "Off switch".

## Goal

Let a merchant pause the AI in one step. Today the agent "Enabled" switch is stored but never read,
takeover only stops the AI for one conversation, and a "Needs attention" conversation flips back to the AI
on the next shopper message.

## Decisions (defaults, stated in PR)

- `agents.enabled = false` means **paused**: the orchestrator never replies for that agent. Shopper messages
  are stored, the conversation moves to `pending-human` ("Needs Attention"), the team gets the usual
  needs-attention WebSocket notification. No automatic customer-facing message is sent.
- A brand-new conversation on a paused agent gets no greeting and just has `needs_processing` cleared.
- `pending-human` is sticky: a new shopper message keeps the conversation in Needs Attention and does not
  re-enqueue the AI. It leaves the queue only via Take Over, or Release → Return to AI.
  Trade-off: multi-turn "humans unavailable" handoff instructions lose their follow-up turn.
- Webchat "Enable webchat widget" keeps its current meaning (removes the widget entirely); documented as such.
- Dashboard copy: "Enable/Disable" → "Pause/Resume", "inactive" badge → "Paused"; strings go through i18n (en + pt-BR).

## Acceptance criteria

- [x] Paused agent + customer message → conversation becomes `pending-human`, `needs_processing=false`, no lock, no LLM call, status change published.
- [x] Paused agent + no customer message → `needs_processing=false`, status unchanged, no greeting.
- [x] Enabled agent → orchestrator proceeds (lock acquired).
- [x] `addCustomerMessage` on a `pending-human` conversation keeps `pending-human` and does not enqueue.
- [x] Agents list: Pause/Resume is one click; badge shows Paused; persists after reload (spec written, see Verify).
- [x] Agent detail page switch copy explains the semantics; i18n en + pt-BR.
- [x] Docs: agents.md (Step 5 + FAQ), conversations.md (status table, takeover section), settings.md (webchat toggle).

## Checklist

- [x] Restate goal + acceptance criteria
- [x] Locate existing implementation (run.ts gate, conversation.entity.ts addCustomerMessage, agents pages)
- [x] Server: paused-agent gate in `runConversation` (after takeover gate, before lock) — commit b745347
- [x] Server: sticky pending-human in `Conversation.addMessage` — commit b745347
- [x] Server tests: `tests/orchestrator/paused-agent-skip.test.ts` (5), `tests/entities/conversation-customer-message-status.test.ts` (4)
- [x] Dashboard: agents/index.vue + agents/[id].vue copy via i18n (en + pt-BR) — commit e63210b
- [x] Playwright: `tests/agent-pause.spec.ts` (pause → badge → reload persists → API enabled=false → resume)
- [x] Docs submodule: agents.md, conversations.md, settings.md — hay-docs branch `claude/agent-pause` @e9f19de
- [ ] Independent review agent on `git diff master...HEAD`; address findings (running)
- [ ] Website lines to change listed in PR
- [ ] WIP.md entry (done), push, PR, docs PR, bump submodule pointer

## Verify (actual results)

- `npm run typecheck` — exit 0 (dashboard nuxt typecheck + server tsc). The "API_DOMAIN environment variable is required in production" line is a Nuxt warning, not a failure.
- `npm run lint` — first run: 1 prettier error in run.ts (fixed with prettier, re-linted OK, amended into b745347).
- `cd server && npx jest tests/orchestrator/paused-agent-skip.test.ts tests/orchestrator/suspended-org-skip.test.ts tests/entities/conversation-customer-message-status.test.ts` — 12 passed, 0 failed (3 suites).
- `npx tsc --noEmit -p tests/tsconfig.json` — 0 errors in agent-pause.spec.ts (5 pre-existing errors in instructions-editor specs).
- `cd dashboard && npx vitest run` — 3 files fail to load, 0 tests: Vitest picks up `dashboard/tests/*.spec.ts` which are Playwright specs ("Playwright Test did not expect test.describe()"). Pre-existing, unrelated.
- Playwright `npx playwright test tests/agent-pause.spec.ts --project=chromium` — NOT RUN. No Hay dev servers on this host: port 3000 is AdGuard, 3001 an unrelated Next.js app; Hay runs as Docker containers built from master, and there is no `.env` to start a local stack. Run on a machine with `npm run dev`.

## Working notes

- `conversationRepository.findById` left-joins `agent`, so `conversation.agent.enabled` is available in `runConversation`.
- Stale detector only scans `status IN ('open','processing')`, so `pending-human` rows are never "recovered" back to the AI.
- Worktree has no node_modules; symlinked from the main checkout. Docs submodule cloned fresh in the worktree; git identity set locally there.
- Website mirrors the user guide under `/srv/hay/hay-website/src/docs/content/user-guide/`; those copies need the same edits.

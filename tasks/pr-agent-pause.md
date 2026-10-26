## Summary

Slice 3 of the prospect-FAQ "fix or stop claiming" list (`tasks/prospect-faq-answers-2026-10-26.md` §13, off switch): let a merchant pause the AI in one step.

- **Agent "Enabled" switch now does something.** `agents.enabled = false` means paused. `runConversation` returns before taking the lock: a conversation that already holds a shopper message is parked as `pending-human` (Needs Attention; `conversationRepository.update` broadcasts the status change), a brand-new conversation (widget just opened) only has `needs_processing` cleared, so no greeting is sent and the sweep stops re-enqueuing it. Conversations a human has taken over are untouched (the takeover gate runs first). The inactivity checker also leaves a paused agent's open conversations alone, so no LLM-written "are you still there?" or closing message goes out. No automatic customer-facing message is sent.
- **Needs Attention is sticky.** A new shopper message on a `pending-human` conversation no longer flips it to `open` and re-enqueues the AI. Only Take Over or Release → Return to AI leave that state. `resolved`/`closed` still reopen for the AI as before.
- **Dashboard copy says what the switch does.** Agents list: Pause / Resume (one click, already existed as Enable/Disable), "Paused" badge, toasts that name Needs Attention; agent page switch reads "Agent active" with a helper. All new strings in `en` and `pt-BR`. The never-set `training`/`error` statuses are gone. Test ids added for the Playwright spec.
- **Webchat "Enable webchat widget"** keeps its meaning (removes the widget, no message); the user guide now says so and points to the agent pause instead.

### Behaviour changes to be aware of

- Sticky `pending-human` means the "no humans available" handoff instructions lose their follow-up turn: after the AI asks for, say, an email, the shopper's reply sits in Needs Attention for a human instead of getting an AI acknowledgement. That is what the briefing asks for ("the hand-off actually stops the bot"), and the user guide now says so next to the handoff instructions.
- A run that already holds the lock when the flag flips finishes its reply.

### Follow-ups (pre-existing, not in this PR)

- Conversations created without an `agent_id` (the websocket path in `websocket.service.ts`) have no agent to pause, so the orchestrator still replies for them.
- "Return to AI" on a paused agent's conversation bounces it straight back to Needs Attention while the dashboard shows the release toast; the release dialog could warn or hide the option when the agent is paused.
- `dashboard` Vitest collects `dashboard/tests/*.spec.ts` (Playwright specs) and fails to load them; exclude `tests/**` in the Vitest config.

## Verification

| Check                                                                                                                                                                                                                             | Result                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (dashboard + server)                                                                                                                                                                                          | exit 0                                                                                                                                                                                                                    |
| `npm run lint`                                                                                                                                                                                                                    | exit 0 (one prettier fix in `run.ts` during the work)                                                                                                                                                                     |
| `cd server && npx jest tests/orchestrator/paused-agent-skip.test.ts tests/orchestrator/inactivity-paused-agent.test.ts tests/orchestrator/suspended-org-skip.test.ts tests/entities/conversation-customer-message-status.test.ts` | 4 suites, 14 tests passed                                                                                                                                                                                                 |
| `npx tsc --noEmit -p tests/tsconfig.json`                                                                                                                                                                                         | 0 errors in `agent-pause.spec.ts` (5 pre-existing in instructions-editor specs)                                                                                                                                           |
| `cd dashboard && npx vitest run`                                                                                                                                                                                                  | pre-existing: Vitest collects `dashboard/tests/*.spec.ts` (Playwright specs) and fails to load them; 0 unit tests exist                                                                                                   |
| `npx playwright test tests/agent-pause.spec.ts --project=chromium`                                                                                                                                                                | **not run**: no Hay dev servers on this host (3000 = AdGuard, 3001 = unrelated Next app, Hay runs in Docker from master, no `.env` for a local stack). Spec is type-clean; please run it on a machine with `npm run dev`. |

Independent review: a second agent reviewed `git diff master...HEAD`. Its two must-fix findings (docs submodule pointer not committed; inactivity checker still messaging shoppers of a paused agent) and three nice-to-haves (duplicate status publish, hardcoded "All Status" label, dead statuses) are addressed in b7996ff. The full list and what was left as follow-ups is in `tasks/todo.md`.

## Docs

User guide changes are in the `docs` submodule: hay-docs branch `claude/agent-pause` @ 02d4388 (agents.md Step 5 + new "How do I pause the AI?" FAQ + handoff note, conversations.md status table + sticky Needs Attention note, settings.md webchat toggle). This PR bumps the submodule pointer to that commit; merge the hay-docs PR first.

## Website lines that now need changing (`/srv/hay/hay-website/src`)

The website mounts hay-docs at `src/docs/content`, so these are fixed by bumping that submodule once the docs PR lands:

- `docs/content/user-guide/agents.md:115-121` (Step 5 "Toggle **Enabled**"), `:265` (Status "enabled or disabled"), `:347-349` ("What happens if I disable an agent? New conversations won't be assigned…" is false: it now pauses replies for every conversation on that agent).
- `docs/content/user-guide/conversations.md:60` (Pending Human row: add "AI stays out until Take Over / Return to AI"), `:118-124` (Release section: sticky note).
- `docs/content/user-guide/settings.md:172` ("Enable webchat widget — master on/off toggle": say it removes the widget with no message).
- `docs/content/user-guide/best-practices.md:319` (Pending Human row: "nobody has picked it up yet" is still right; consider adding "or the agent is paused").

No marketing page currently claims a one-step pause, so nothing there to retract; the pricing and feature pages may now safely say "pause the AI with one click from the Agents page".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Playbook "Handoff to human" action (planned, successful escalation)

## Goal & acceptance criteria

Let a playbook author drop a **"Handoff to human"** step into a playbook. When the
AI follows it and hands off, that handoff is treated as a **planned** escalation —
the playbook working as designed — not a fallback/giveup. At close it classifies as
a **successful** outcome in its own analytics bucket, distinct from both pure
AI-resolution and fallback escalation.

Done when:

- [ ] Author can insert a "Handoff to human" step in the playbook editor.
- [ ] The step renders into the planner prompt as an explicit instruction.
- [ ] When the planner emits HANDOFF while a handoff-bearing playbook is active, the
      conversation is marked as a **planned** handoff (deterministic, not LLM self-labeled).
- [ ] At close, a planned handoff classifies as `assisted` (successful) — NOT `human`.
- [ ] Fallback handoffs (guardrail / low-confidence / no playbook) still classify as `human`.
- [ ] Analytics surfaces `assisted` as its own bucket; it is excluded from the
      escalation/failure count.
- [ ] Unit tests cover the outcome mapping; `npm run typecheck` + `npm run lint` pass;
      server jest (outcome-rules + orchestrator handoff) pass.

## Key decision (needs Roger's sign-off)

**Is a planned handoff billable?** Recommended default: **yes** — model it as `assisted`,
a billable success, consistent with the existing rule "hand-offs bill when the AI
resolved it" (`outcome-rules.ts:14`). The AI did its job by correctly following the
playbook to bring in a human. Alternative if you want caution: count `assisted` as a
successful outcome in analytics but keep it **non-billable** (one-line change to
`BILLABLE_OUTCOMES`). Everything else in the plan is identical either way.

## Design (grounded in current code)

**Planned vs fallback is deterministic**, not an LLM judgment: a handoff is "planned"
iff the active playbook contains a handoff step AND the planner emitted HANDOFF. This
matches author intent and avoids unreliable self-labeling. The already-separate
guardrail/low-confidence code paths (`execution.layer.ts:505/645/898`) stay `fallback`.

**Reuse existing machinery** (per CLAUDE.md): a handoff is a new mention `type: "handoff"`
inserted by a slash command — not a brand-new ProseMirror node. The server-side
`analyzeTiptapInstructions` already walks mention nodes and builds the planner markdown;
extend it to (a) render a handoff instruction line and (b) report `hasHandoff`.

## Plan (thin vertical slices)

### Phase 1 — Outcome foundation (server, no UI) — highest value, lowest risk

- `server/utils/tiptap-formatter.ts`: detect `type: "handoff"` mention nodes →
  add `hasHandoff: boolean` to `InstructionAnalysis`; render an explicit instruction
  line into the markdown (e.g. "→ At this point, hand off to a human team member.").
- `server/database/entities/conversation.entity.ts`: in `updatePlaybook` (and the
  sibling analyze sites at ~693/1309), when `analysis.hasHandoff`, persist a planned
  marker. Minimal: `metadata.playbookPrescribesHandoff = true` (no migration). If we
  prefer a typed column, add `planned_handoff_at` (needs migration — see DB conventions).
- `server/orchestrator/run.ts` HANDOFF branch (~1359): when the marker is set, record
  the handoff as planned (set `metadata.plannedHandoff = true` alongside `handed_off_at`).
- `server/services/close-classification/outcome-rules.ts`:
  - Add `plannedHandoff: boolean` to `CloseFacts` + populate in `collectCloseFacts`.
  - Add `"assisted"` to `CONVERSATION_OUTCOMES` (+ to `BILLABLE_OUTCOMES` if billable).
  - In `decideOutcome`, before the `!verdict.aiResolved → human/abandoned` branch:
    `if (facts.plannedHandoff && facts.hadRealRequest) return decide("assisted", true);`
    (placed after the `unhappy`/`teamAssisted` guards so a shopper's "didn't help" and
    a quick-check human answer still win.)
- Tests: extend `server/tests/orchestrator/` outcome/handoff tests + outcome-rules unit
  tests (pure module — cheapest high-value coverage).

### Phase 2 — Planner awareness (server)

- Confirm the rendered handoff instruction is clear to the planner; add a one-line note
  in `execution/planner` prompt if needed. Likely a no-op if the markdown line suffices.

### Phase 3 — Editor UI (dashboard) — read `.claude/FRONTEND.md` first

- `dashboard/components/tiptap/SlashCommand.ts`: add a "Handoff to human" command
  (icon e.g. `user-round`) whose `command` directly inserts a handoff mention node.
- `dashboard/components/tiptap/MentionExtension.ts`: add `"handoff"` to `MentionItem.type`;
  render the chip (distinct style, no plugin thumbnail).
- `MentionList.vue` / `SlashCommandList.vue`: handle the new type (no submenu — direct insert).
- `dashboard/types/playbook.ts`: extend types as needed.

### Phase 4 — Analytics (server + dashboard)

- `server/services/analytics.service.ts`: surface `assisted` as its own series; ensure
  the escalation/failure metric counts `human` (fallback) but NOT `assisted`.
- Dashboard analytics page: three-way split (AI-resolved / assisted / fallback escalation).

### Phase 5 — Verify

- `npm run typecheck`, `npm run lint`.
- `cd server && npm test` (outcome-rules + orchestrator handoff/ask-team suites).
- `cd dashboard && npm test`.
- Manual: seed a playbook with a handoff step, drive a chat via `hay chat send` until
  handoff, close it, confirm the stored outcome is `assisted`.

## Working notes / invariants

- Branch: `claude/brave-thompson-619cnu` (currently == master; no unmerged commits).
- Don't break existing handoff flows: guardrail/low-confidence/no-playbook handoffs
  must remain `human`.
- `handed_off_at` is never cleared — reuse it; don't add parallel handoff timestamps.
- DB change only if we choose a typed column over a metadata flag (follow
  `server/database/DATABASE_CONVENTIONS.md`; snake_case, migration).

## Decisions (locked with Roger, 29 Oct 2026)

- Planned handoff is **billable** → new `assisted` outcome in `BILLABLE_OUTCOMES`.
- Planned marker stored in **conversation.metadata** (`plannedHandoff`), no migration.

## Results — what changed & how verified

### Changed (no migrations)

Server:

- `server/utils/tiptap-formatter.ts` — `InstructionAnalysis.hasHandoff`; a `handoff`
  mention renders the instruction line "**Hand off to a human teammate at this point
  in the process.**"; `containsHandoffMention` walk. Exported `HANDOFF_MENTION_TYPE`.
- `server/database/entities/conversation.entity.ts` — `updatePlaybook` persists
  `metadata.playbookPrescribesHandoff` from the analysis.
- `server/orchestrator/run.ts` — HANDOFF branch sets `metadata.plannedHandoff = true`
  when the active playbook prescribes a handoff and it's not a guardrail/outage fallback
  (`!executionResult.confidence && !executionResult.aiUnavailable`).
- `server/services/close-classification/outcome-rules.ts` — new billable `assisted`
  outcome; `plannedHandoff` fact; `decideOutcome` maps planned handoff → `assisted`
  (after unhappy/teamAssisted guards). Exported `BillableOutcome` union.
- `server/services/resolution-ledger.service.ts` — `notBilled` breakdown now groups by
  `NotBilledOutcome = Exclude<Kind, BillableOutcome>` so `assisted` sits in `billed`.
- `server/routes/v1/conversations/index.ts` — `escalations` + `escalatedConversations`
  exclude conversations whose `metadata.plannedHandoff` is true (planned ≠ escalation).
  Dashboard:
- `components/tiptap/SlashCommand.ts` — "Handoff to human" slash command (inserts a
  `handoff` mention directly, no submenu).
- `components/tiptap/SlashCommandList.vue` — `user-round` icon mapping.
- `components/tiptap/MentionExtension.ts` — `mention-handoff` chip + icon rendering.
- `components/InstructionsTiptap.vue` — orange `.mention-handoff` styles + person icon.
  Tests:
- `server/tests/services/close-outcome-rules.test.ts` — `assisted` mapping + precedence
  (unhappy/teamAssisted/spam/test still win) + `collectCloseFacts` reads the flag.

### Verification

- `npm run typecheck:server` — pass. `npm run typecheck:dashboard` — pass.
- `eslint` on all changed server + dashboard files — clean (exit 0).
- `jest close-outcome-rules` — 31 pass (incl. new assisted + planned-handoff tests).
- `jest execution-ask-team execution-always-fact-check` + handoff copy/transcript — pass.
- Integration suite `tests/integration/resolution-ledger.test.ts` could NOT run here:
  no DB reachable from this sandbox (`ENOTFOUND` on the remote DB host). Not a
  regression — needs a live Postgres. Run it where the DB is reachable.
- Not run: live app / `hay` CLI manual walkthrough (needs running stack + DB).

### Follow-ups (not built; out of this slice)

- Optional explicit dashboard "assisted / planned handoff" analytics series.
- Let playbook templates (`markdownToTiptapJSON`) seed a handoff step.
- Consider skipping the close-classifier LLM call for planned handoffs (cost).

# Spec: fewer menu items, one assistant per org (2026-10-29)

Three PRs, landed in this order. Each one is shippable on its own.

| PR  | Scope                                             | Touches                       |
| --- | ------------------------------------------------- | ----------------------------- |
| 1   | Settings submenu regrouped (13 entries → 6)       | dashboard only                |
| 2   | Main sidebar regrouped (15 entries → 9)           | dashboard only                |
| 3   | Agents removed; the organization is the assistant | server, migrations, dashboard |

PR 1 and PR 2 are pure navigation and copy. PR 3 is the paradigm change and gets its own
plan, tests and migration.

---

## Why

- The sidebar has 15 top-level items of three different kinds (daily work, one-time setup,
  occasional checks) at the same level, so nothing stands out.
- The settings submenu has 13 entries, two of them both called "Privacy".
- Agents exist only so a channel can get different behavior. Early testers created several
  agents instead of writing playbooks. Playbooks already describe when they apply, so the
  model can route by topic on its own; a second identity adds nothing. The routing helper in
  `server/services/agent-channel-routing.ts` and its shared-channel warning exist only to
  resolve conflicts the agent model itself creates.

Decided in discussion (Roger, 2026-10-29): no paying or pilot customers, so no data
migration concerns beyond dev/test orgs. No per-channel behavior overrides either; a channel
is metadata the prompt can see, not something a human configures.

---

## PR 1: Settings submenu

### Target structure

| Entry           | Tabs / content                                       | Replaces today                    |
| --------------- | ---------------------------------------------------- | --------------------------------- |
| Assistant       | Identity, Actions, AI Models (see PR 3 for Identity) | Agents, Actions, AI Models        |
| Channels        | Channel list, Webchat, Business Hours                | Channels, Webchat, Business Hours |
| Workspace       | General, Users                                       | General, Users                    |
| Privacy         | Workspace data, Customer privacy                     | Privacy & Data, Customer Privacy  |
| Developers      | API Tokens, Git Connections                          | API Tokens, Git Connections       |
| Billing & Usage | Usage, link out to billing                           | Usage, Billing (main sidebar)     |

- My Profile stays as the single per-user entry; the unlinked `settings/security.vue` page
  becomes a tab of it.
- Until PR 3 lands, the Assistant entry's Identity tab links to the existing agents page.

### Mechanics

- Keep one route per existing page (no URL churn for tests); group them in
  `dashboard/components/layout/AppSidebar.vue` and switch the pages to a shared tabbed
  settings layout. Check `.claude/FRONTEND.md` for the existing `Page` + tabs pattern
  before building a new one.
- Role gates stay exactly as they are per page; a group shows if any of its tabs is visible.
- i18n: new `nav.*` keys in `en` and `pt-BR`; remove keys no longer referenced.

### Acceptance

- [ ] Settings submenu shows at most 6 entries plus My Profile for an owner, fewer for lower roles.
- [ ] Every existing settings route still renders, with its tab selected.
- [ ] Playwright navigation specs updated; `npm run typecheck:dashboard` and `npm run lint` pass.

---

## PR 2: Main sidebar

### Target structure

| Entry           | Content                                                                     | Replaces today                 |
| --------------- | --------------------------------------------------------------------------- | ------------------------------ |
| Getting Started | unchanged, hidden after onboarding                                          | Getting Started                |
| Inbox           | unchanged                                                                   | Inbox                          |
| Conversations   | tabs: Conversations, Action log                                             | Conversations, Action log      |
| Knowledge       | tabs: Documents, Playbooks, Products (tab only when a product plugin is on) | Documents, Playbooks, Products |
| Tests           | unchanged (moves under Assistant settings only if PR 3 makes that natural)  | Tests                          |
| Evidence packs  | unchanged; stays top-level, it is a selling feature                         | Evidence packs                 |
| Reports         | tabs: Dashboard, Insights, Feedback                                         | Dashboard, Insights, Feedback  |
| Integrations    | unchanged                                                                   | Integrations                   |
| Settings        | see PR 1                                                                    | Settings, Billing              |

- Reports keeps the existing role gate: the agent role sees only the Dashboard tab.
- The Conversations badge stays on the group entry.
- Deep links (`/insights/feedback`, `/actions`, `/products`) keep working and select their tab.

### Acceptance

- [ ] At most 9 top-level entries for an owner with onboarding done and no product plugin: 8.
- [ ] Badges, role gates and the product-plugin gate behave as before.
- [ ] Playwright navigation specs updated; typecheck and lint pass.

---

## PR 3: Remove agents, the organization is the assistant

### Model

One assistant per organization, configured on the organization. Playbooks are org-level
and always active. Channels only say whether the AI replies there (that already exists as
the per-channel enablement in plugin instances).

Fields that move from `agents` to `organizations` (names kept, snake_case in DB per
`server/database/DATABASE_CONVENTIONS.md`):

| Field                                       | Notes                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| name, description, avatar_upload_id         | assistant name is separate from the organization name |
| instructions (Tiptap), tone, avoid, trigger |                                                       |
| initial_greeting, language                  | language already has an org-level fallback; keep one  |
| human_handoff_available_instructions        |                                                       |
| human_handoff_unavailable_instructions      |                                                       |
| human_handoff_unavailable_ticket            |                                                       |
| test_mode                                   |                                                       |

Fields that disappear:

| Field                          | Why                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| agents.enabled                 | already superseded by `aiPausedAt` / `agentPausedAt` on the org                     |
| agents.channels                | no routing                                                                          |
| organizations.default_agent_id | no agents                                                                           |
| playbook_agents join table     | playbooks belong to the org and are always on                                       |
| conversations.agent_id         | the org answers; `Conversation.updateAgent()` builds the system prompt from the org |
| simulation_runs.agent_id       | runs always use the org assistant                                                   |

Prefer a dedicated `assistant` jsonb or column group on the organization only if the
organization entity is already crowded; otherwise plain columns. Decide when touching the
entity, state it in the PR.

### Migration

1. Add the new columns to `organizations`.
2. For each org, copy the fields from `default_agent_id`'s agent, else the oldest agent.
   Orgs with no agent get nulls.
3. Drop `playbook_agents`, `conversations.agent_id`, `simulation_runs.agent_id`,
   `organizations.default_agent_id`, then `agents`.
4. One migration, reversible only as "down drops the new columns" (no customers, no need to
   restore agents).

### Server changes

- Delete `agent.entity.ts`, `agent.repository.ts`, `agent.service.ts`,
  `agent-channel-routing.ts`, `routes/v1/agents/`, and their tests.
- `conversation.service.ts`, `orchestrator/run.ts`, `execution.layer.ts`,
  `prompt.service.ts`, `playbook.service.ts`, the simulation services, analytics,
  audit log, close classifier, soft-launch readiness, feedback insights, and the plugin API
  router all stop looking up an agent and read the org. About 40 server files reference
  `agentId` today; most become a one-line change.
- `Conversation.updateAgent()` becomes `applyAssistant()` (or inline in the orchestrator) and
  builds the system prompt from the org.
- Organization tRPC router gains `assistant.get` / `assistant.update`; approval settings
  (currently "inherit from org / require / auto-send" on the agent) collapse to the org
  value only.
- Playbook create/update drops the agent assignment input; list returns all org playbooks.
- Update `server/orchestrator/ARCHITECTURE.md`.

### Dashboard changes

- Delete `pages/agents/`, move `components/agents/HandoffTicketSettings.vue` under
  `components/settings/`.
- New `pages/settings/assistant.vue` (Identity tab of the Assistant group from PR 1) with
  the fields above. Reuse the current agent form sections as-is where possible.
- Playbook editor: remove agent picker. Tests page and readiness card: remove agent picker.
- Getting Started: step "Create an agent" becomes "Describe your assistant", completed when
  `instructions` or `name` is set.
- `settings/general.vue` loses the default-agent selector.
- Remove `i18n/locales/*/agents.json`, add `assistant.*` keys, update `nav.*`.
- `npm run generate:trpc` after router changes.

### Other places to check

- `tools/hay-cli` commands that take an agent id.
- `docs/user-guide/*` pages mentioning agents.
- Plugin SDK / plugin API types exposing `agentId` to plugins.
- The unmerged `claude/agent-pause` branch: its org-level pause is what replaces
  `agents.enabled`; land it first or rebase this on it.

### Acceptance

- [ ] No `agents` table, no `Agent` entity, no `/agents` route or page.
- [ ] A fresh org can set assistant name, instructions, tone and handoff texts from Settings
      and get a reply on webchat using them (`hay chat send` shows the name in the prompt).
- [ ] All playbooks of an org apply without any assignment step.
- [ ] Tests (simulations) run against the org assistant; action log and conversations no
      longer show an agent column or filter.
- [ ] Getting Started completes the assistant step after saving the form.
- [ ] Migration runs on a dev DB with two agents and keeps the default one's settings.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test:server`, `npm run test:dashboard`
      pass; Playwright specs touching agents are rewritten.

### Out of scope

- Per-channel behavior overrides (tone, greeting). If it ever comes back, it is a field on
  the org assistant keyed by channel, never a second entity.
- Multiple personas per org.

---

## Open questions (defaults taken unless answered)

1. Assistant name default when an org has no agent: the organization name.
2. Where `test_mode` lives after the move: on the org, surfaced on the Tests page, not in
   Assistant settings.
3. Whether the Tests page moves under Settings → Assistant in PR 2: no, it stays top-level
   until PR 3 shows whether that feels natural.

# Context: why this task exists

You are working on Hay.chat, an AI customer-support agent for e-commerce stores (Shopify, WooCommerce,
Magento, Wix; channels: web widget, WhatsApp, Instagram, Chatwoot). Repos on this machine:

- `/srv/hay-core/repo` – product: `server/` (Express + tRPC + TypeORM), `dashboard/` (Nuxt 3), `webchat/`
  (embeddable widget), `plugins/core/*` (integrations), `tests/` (Playwright e2e). Read `CLAUDE.md`,
  `.claude/FRONTEND.md` and `WIP.md` first.
- `/srv/hay/hay-backoffice` – billing, trials, Stripe, suspension. Source of truth for plans is `billing-plans.json`.
- `/srv/hay/hay-website/src` – marketing site (Eleventy), pricing page, terms, refund policy, compare pages.

## The problem we are fixing

An SEO and market briefing (Oct 2026, ~15,000 reviews and forum posts read) found that our copy is blocked
on product facts, and that when we checked those facts against the code, several things the website or
docs claim are not what the product does. Buyers' loudest complaints about this category are exactly the
areas where we are weakest or inconsistent:

- **How the bill is built**: "charged for tickets the AI didn't solve", abandoned chats billed as
  resolutions, plans that never step down, no warning before overage, overnight suspensions.
- **AI they cannot see into or switch off**: owners want to see where an answer came from, correct it,
  and pause the agent in one step.
- **Reaching a person**: what happens out of hours, from a phone, and whether the hand-off actually
  stops the bot.

Every claim on hay.chat has to survive a sceptical merchant and an AI fact-check, so each gap is being
closed either by changing the product to match the claim or by changing the claim to match the product.
The full code-grounded answer sheet, with file:line evidence for each of the 14 product-fact questions
and a prioritised "fix or stop claiming" list, is in `tasks/prospect-faq-answers-2026-10-26.md`.
Read it before starting. Your task below is one slice of that list.

## How to work

1. **Plan first.** Restate the goal and acceptance criteria in `tasks/todo.md` (checklist, including
   explicit Verify items). If the task is ambiguous or a design choice would materially change the
   outcome, ask exactly one targeted question with a recommended default before coding. Otherwise
   proceed on sensible defaults and state them.
2. **Worktree.** Do all code work in a git worktree named `claude/<slug>` off `master` (use the
   EnterWorktree tool or `git worktree add`). Never edit `master` directly. Commit atomically with
   clear messages.
3. **Follow conventions.** Existing patterns before new abstractions. Database changes must follow
   `server/database/DATABASE_CONVENTIONS.md` (snake_case DB, camelCase TS, migrations, never
   `synchronize`). tRPC via `Hay` in the dashboard. shadcn-vue components from `components/ui`.
   i18n: every new UI string goes in both `dashboard/i18n/locales/en` and `pt-BR`. This is alpha
   software: remove dead code, do not keep backwards-compat shims.
4. **Tests with the change.** Add the smallest unit/integration tests that would have caught the bug or
   that pin the new behaviour (`server/` Jest, `dashboard/` Vitest). Run `npm run typecheck`,
   `npm run lint` and the relevant test suites. Report actual output; do not say "passes" without running.
5. **Independent review.** When the implementation is green, spawn a separate reviewer agent. Give it
   the diff (`git diff master...HEAD`), the task text and the acceptance criteria, not your conclusions.
   Ask it for correctness bugs, missed call sites, convention violations and untested paths. Fix what it
   finds, or write down why you disagree. Record the outcome in `tasks/todo.md`.
6. **Playwright e2e on the UI.** If the change touches anything a user sees in the dashboard or widget,
   add a Playwright spec under `tests/` (config: `playwright.config.ts`, baseURL `http://localhost:3000`,
   auth via `tests/helpers/auth.ts` and `tests/global-setup.ts`, env in `.env.test`). Follow the style of
   the existing specs (e.g. `tests/instructions-editor.spec.ts`). The spec must exercise the real user
   path for this task end to end (navigate, act, assert the visible result and, where relevant, the
   persisted state). Run it with `npx playwright test <spec> --project=chromium` and report the result.
   Assume the dev servers may already be running (`reuseExistingServer`); do not start `npm run dev`
   yourself unless Playwright's webServer does it.
7. **Docs and copy in step.** If the change alters what the product does, update `docs/user-guide/*`
   in the same PR and list every hay.chat website or compare-page line that now needs changing (file
   path in `/srv/hay/hay-website/src`), so the copy can be corrected in the same breath. Do not edit the
   website repo unless the task says so.
8. **Checkpoint relentlessly.** Sessions end without warning. After each meaningful chunk, prepend a
   max-10-line entry to `WIP.md` (date, worktree, what works, what is half-built, exact next step) and
   keep `tasks/todo.md` current. Never leave uncommitted work without saying so.
9. **Finish.** When done and verified: push the branch, open a PR against `master` with a summary body
   that includes the verification story (what you ran, results) and the list of website lines to change.
   Record any correction or lesson in `tasks/lessons.md`.

## Definition of done

- Behaviour matches the acceptance criteria and is covered by tests at the right level.
- Typecheck, lint, unit/integration tests and the Playwright spec are green, with output shown.
- A second agent reviewed the diff and its findings were addressed.
- User guide updated; website lines to change listed in the PR.
- `WIP.md` and `tasks/todo.md` reflect the final state.

---

# Task


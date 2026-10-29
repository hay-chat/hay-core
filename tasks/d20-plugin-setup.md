# D20 Plugin setup UX — phase 1 (Wave 4, branch claude/w4-d20-plugin-setup)

Research: `Engineering/02 Research/D20 Plugin setup UX.md` (Roger accepted every recommendation, 29 Oct 2026).

## Plan

- [x] D20-0 re-check the research against master
- [x] D20-1 quick fixes on the current plugin page
- [x] D20-2 i18n of the generic form + OAuth card, plugin field labels, locale renames, en/pt-BR hard check
- [x] D20-3 SDK + server: `advanced` fields, `managed` resolver metadata, override policy (env flag)
- [x] D20-4 standard page: status header, tabs, Advanced mode, badges, ⋯ menu, Enable → Connect (vitest 82/82, nuxt dev vue-tsc 0 errors, Playwright 390px + 1440px)
- [x] D20-5 `register.setup({steps})`, status contract, core checklist + fallback steps, build-plugin skill
  - Decision: the worker endpoint is `POST /setup/status` (not GET): core sends the resolved config + authState, same as cron, so the handler sees fresh credentials. Dashboard reads it through tRPC `plugins.setupStatus` (null when undeclared/unavailable; 5 s timeout, zod-validated).
  - Verified end to end with a temporary `register.setup` in hubspot's gitignored dist (restored): metadata.setup served, status returned, checklist rendered at 390 px and 1440 px.
- Verify each slice: plugin-sdk vitest, dashboard vitest, server jest (config resolver / handler), Playwright 390 px + desktop.

## D20-0 findings (master @ 15440c33)

Confirmed:

- `[pluginId].vue` (1500 lines) still renders tools above setup, the OAuth card above the form, the
  `after-settings` slot last, `{{ testResult }}` raw (:568), `description || "Version x"` (:102),
  and the Capabilities card only understands object capabilities for chat/document (:250-313).
- `PluginConfigForm.vue` / `PluginOAuthConnection.vue`: all strings hardcoded English.
- `getConfigLabel` / `getConfigDescription` (`useToolLabel.ts`) still unused.
- Locales: `pt.json` in calcom, shopify, wix; en only in chatwoot, twenty; no i18n in atlassian, notion.
- `config-resolver.ts` unchanged (source/canOverride/hasEnvFallback, no `managed`).
- `configurePlugin` required-field error names the env var ("or set X in your environment").

Changed since the research:

- The "OAuth not configured" case now shows an alert (`oauth-unavailable-alert`), not nothing.
- New channel-health alert (D13-11) on the page.
- 20 core plugins now: + mercadopago, messenger, nuvemshop, turnstile. The Email tool is merged into
  email-channel (`notificationRecipients`). WooCommerce has its own `after-settings` connect page.
- 86 config fields in total (inventory dumped by loading each plugin's `onInitialize`).

Env/tooling notes:

- Dashboard component tests that need jsdom cannot run here (jsdom not installed); pure-logic tests only.

## Results (phase 1)

- D20-0..5 done; see commits on `claude/w4-d20-plugin-setup`.
- Tests: plugin-sdk vitest 244/244, dashboard vitest 88/88, server jest tests/lib 89/89, server tsc clean (minus known sharp/compression/file-type), dashboard `nuxi typecheck` exit 0 (worktree-local npm ci).
- Phase 2 needs: plugins adopt `register.setup` + `setupSteps.*` i18n (label test enforces), `advanced: true` on technical fields (Shopify apiVersion/authMode, Notion notionVersion…), marketplace + error copy.

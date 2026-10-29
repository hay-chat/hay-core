# D20 Plugin setup UX — phase 1 (Wave 4, branch claude/w4-d20-plugin-setup)

Research: `Engineering/02 Research/D20 Plugin setup UX.md` (Roger accepted every recommendation, 29 Oct 2026).

## Plan

- [x] D20-0 re-check the research against master
- [x] D20-1 quick fixes on the current plugin page
- [x] D20-2 i18n of the generic form + OAuth card, plugin field labels, locale renames, en/pt-BR hard check
- [x] D20-3 SDK + server: `advanced` fields, `managed` resolver metadata, override policy (env flag)
- [ ] D20-4 standard page: status header, tabs, Advanced mode, badges, ⋯ menu, Enable → Connect
- [ ] D20-5 `register.setup({steps})`, `GET /setup/status`, core checklist + fallback steps, build-plugin skill
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

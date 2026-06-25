# HAY-110 — Salesforce Integration

**Goal:** Hay can read and update Salesforce contacts and cases (and other sObjects) to keep CRM data synchronized with automated conversations.

## Approach

Archetype A (local bundled MCP), mirroring `plugins/core/twenty`. Salesforce REST API
via OAuth 2.0 **Client Credentials Flow** (Connected App): user supplies instance URL +
consumer key + consumer secret; the MCP server exchanges them for an access token and
re-fetches on 401. Generic sObject tools (SOQL + describe + CRUD) cover Contacts and Cases
plus any other object.

## Acceptance criteria

- [ ] `plugins/core/salesforce` recognized as a plugin (`package.json` → `hay-plugin`, no manifest.json)
- [ ] Config: instanceUrl, clientId, clientSecret (encrypted); apiKey-style auth gate on clientSecret
- [ ] `onValidateAuth` does a real token-exchange round-trip with user-facing errors
- [ ] `onStart` gates on creds, spawns `./mcp` over stdio
- [ ] MCP tools: `soql_query`, `describe_sobject`, `list_sobjects`, `get_record`, `create_record`, `update_record`
- [ ] Token exchange + retry (429/5xx) + 401 re-auth in one shared `sfApi()` helper
- [ ] i18n en + pt with label/description for every tool and config field
- [ ] `mcp/node_modules` committed pruned (dependency-gap policy), README notes it
- [ ] `npm run build` + `typecheck:server` pass; tools appear in /mcp/list-tools

## Tasks

- [ ] Scaffold package.json + tsconfig + src/index.ts
- [ ] MCP server: lib/client.js (token + sfApi), lib/format.js, tools/\*
- [ ] i18n en.json + pt.json
- [ ] README
- [ ] Install deps, build, typecheck, verify tool list

## Results

Built `plugins/core/salesforce` (archetype A, mirrors twenty):

- `src/index.ts` — config (instanceUrl/clientId/clientSecret), apiKey-auth gate on clientSecret,
  `onValidateAuth` does a live client-credentials token exchange with user-facing errors,
  `onStart` gates on creds + spawns `./mcp` over stdio.
- `mcp/lib/client.js` — client-credentials token exchange, shared `sfApi()` with 429/5xx retry +
  single 401 re-auth; `SalesforceApiError` surfaces real SF error bodies. API `v60.0`.
- `mcp/tools/{query,metadata,records}.js` — 7 tools: soql_query, query_more, list_sobjects,
  describe_sobject, get_record, create_record, update_record. Generic over all sObjects.
- `i18n/en.json` + `i18n/pt.json` — label/description for every tool + config field.
- `README.md` — Connected App + Client Credentials Flow setup; build via build-plugins.sh.

**Verification:**

- `npm run build --workspace=plugins/core/salesforce` → dist/ emitted ✓
- `npm run typecheck:server` → clean ✓
- mcp files `node --check` ✓; JSON validates ✓
- Spawned the MCP server over stdio → all 7 tools register with correct schemas ✓
- i18n tool keys match registered tool names exactly (en + pt) ✓

**Follow-ups (TODO):**

- Add `thumbnail.jpg` (Salesforce logo) — non-blocking; email-imap/wix also ship without one.
- Live round-trip against a real Salesforce org (needs a Connected App with Client Credentials
  Flow + Run-As user) — not possible without credentials in this environment.

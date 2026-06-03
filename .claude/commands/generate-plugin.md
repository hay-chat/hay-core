---
description: Generate a Hay plugin from an MCP server GitHub repository
---

# Generate a Hay Plugin from an MCP Server Repo

Create a Hay plugin that wraps an existing MCP (Model Context Protocol) server repository.
This is **Archetype A (local bundled MCP server)** — you vendor the server's code into `mcp/`
and write a thin Hay entry around it.

**GitHub Repository URL:** {{args}}

## Read these first

- **`.claude/skills/build-plugin/SKILL.md`** — the authoritative plugin contract, archetypes, and
  templates. This command is just the "wrap an existing MCP repo" path through that skill.
- **`.claude/skills/build-plugin/reference/anti-patterns.md`** — especially **"The mcp/ dependency
  gap"** (the runtime does not `npm install` inside `mcp/`) and **"Don't vendor a third-party repo
  wholesale"** (no `.git/`, `LICENSE` bloat, agent-context dirs, or test scripts).

## Ground truth (the old version of this command was wrong about all of these)

- Plugins live in **`plugins/core/<name>/`** (not a flat `plugins/`).
- There is **NO `manifest.json`** and **no `plugins/base/` schema**. Metadata is the `hay-plugin`
  block in `package.json`. The plugin ID is the npm `name` (`hay-plugin-<name>`).
- The entry is `src/index.ts` with a **default export of `defineHayPlugin(...)`** from
  `@hay/plugin-sdk` (`"file:../../../packages/plugin-sdk"`). ESM only; `tsconfig` `strict:true`,
  `exclude: ["mcp"]`.
- Category is one of `integration | channel | tool | analytics`.
- **Reference plugin: `plugins/core/klaviyo`** — the clean local-MCP example to mirror.

## Steps

1. **Ask the essentials** (one at a time):
   - Plugin name → `hay-plugin-<name>`
   - One-sentence description + display name
   - Category (`integration` unless it's a channel/analytics tool)
   - Auth method (apiKey / oauth2 / none) and the config fields the user must supply
   - Whether the upstream server is **local** (vendor it → this command) or **remote/hosted**
     (then use Archetype B `ctx.mcp.startExternal` instead — see the skill, don't vendor)

2. **Scaffold** from `.claude/skills/build-plugin/templates/` (`package.json`, `tsconfig.json`,
   `index.ts`, `mcp-server.js`). Fill placeholders; set `capabilities` to `["mcp"]` (+`"auth"` if
   it has auth).

3. **Vendor the MCP server** into `plugins/core/<name>/mcp/`:
   - Copy **only the server source** — strip `.git/`, `LICENSE` boilerplate, docs, `memory-bank/`,
     test scripts, and unused deps.
   - Give `mcp/` a minimal `package.json` declaring **only the deps it actually imports**
     (`@modelcontextprotocol/sdk` + the rest).
   - Ensure it uses `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`), reads creds
     from `process.env`, logs to `console.error`, and returns proper `content`/`isError` envelopes.
     If the upstream hand-rolls JSON-RPC or ships empty tool schemas, fix it (see anti-patterns).

4. **Wire `onStart`** to spawn it: `ctx.mcp.startLocalStdio({ command:"node", args:["index.js"],
cwd:"./mcp", env:{ /* creds from ctx.config */ } })`. Add a real `onValidateAuth` round-trip.

5. **Resolve the dependency-install gap**: either commit a pruned `mcp/node_modules`
   (`npm install --omit=dev` in `mcp/`) or add an `mcp/` install step to the build. Note your
   choice in the plugin's README. The plugin will not start otherwise.

6. **Build & verify** from repo root:
   ```bash
   npm install   --workspace=plugins/core/<name>
   npm run build --workspace=plugins/core/<name>
   npm run typecheck:server
   ```

## Validation checklist

- [ ] `package.json` has a correct `hay-plugin` block; **no `manifest.json`**.
- [ ] `src/index.ts` default-exports `defineHayPlugin`; ESM; `strict:true`.
- [ ] Every secret config field is `encrypted:true`; nothing logs credentials.
- [ ] `mcp/` declares every dep it imports; no vendored `.git`/LICENSE/docs cruft; no TLS bypass.
- [ ] All upstream tools exposed with real zod schemas (key `inputSchema`, not `input_schema`).
- [ ] Dependency-install approach for `mcp/` chosen and documented; server actually starts.
- [ ] `npm run build` + typecheck pass; tools appear in `/mcp/list-tools`.

For anything not covered here (channels, remote MCP, OAuth, UI pages), defer to
`.claude/skills/build-plugin/`.

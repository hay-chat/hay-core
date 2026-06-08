# Notion (document importer)

Imports Notion pages and database entries into Hay's knowledge base, the same
way the Atlassian plugin imports Confluence pages. It is a **document importer**
(archetype D): it implements the `DocumentImporterContract` via a tRPC router
that the core document-source sync engine drives. There is **no bundled MCP
server** and therefore no `mcp/` dependency-install concern.

## Setup

1. Create an **internal integration** at <https://www.notion.so/my-integrations>
   and copy its token (starts with `ntn_` or `secret_`).
2. In Notion, **share** every page/database you want imported with the
   integration (Notion only exposes shared content to the API — this sharing is
   the import scope boundary).
3. In Hay, configure the Notion plugin with the token, then create a document
   source and pick a root.

## Roots

`listRoots` returns:

- **All shared pages** (`workspace`) — every page the integration can see,
  enumerated via `POST /v1/search`. This includes database rows and standalone
  pages.
- **One root per database** (`db:<id>`) — just the rows of that database, via
  `POST /v1/databases/{id}/query`.

Pick one per document source. The two overlap (workspace contains database
rows), so choose the workspace root for everything or a database root for a
focused subset.

## Sync semantics

- **Full sweep** — `discover` paginates the root, `fetchPage` pulls each page's
  block tree (recursively, bounded) and converts it to Markdown via the pure
  `notion-to-markdown` transform.
- **Incremental** — `listChanges` queries the root sorted by `last_edited_time`
  descending and stops once it passes the `since` watermark.
- **Deletions** — Notion's search/query endpoints omit trashed pages, so
  deletions are reconciled by the sync engine's full-sweep tombstoning pass, not
  detected incrementally.

## Build

```bash
# from repo root
npm install --workspace=plugins/core/notion
npm run build  --workspace=plugins/core/notion
npm run typecheck:server
```

`build` runs `tsc` (ESM → `dist/index.js`, `dist/notion-client.js`,
`dist/notion-to-markdown.js`) and bundles `src/router.ts` → `dist/router.cjs`
with esbuild (server internals externalized), matching the Atlassian plugin.

> **TODO:** add a `thumbnail.jpg` (Notion logo) — core resolves the plugin icon
> from `./thumbnail.jpg`.

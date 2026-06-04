# Twenty CRM Plugin

Connect any [Twenty CRM](https://twenty.com) workspace to Hay — Twenty Cloud or a self-hosted
instance — using **your own** workspace base URL and API key. Generic by design: no
workspace-specific fields are hardcoded, so anyone can use it with their own account.

## What it does

Spawns a local Node MCP server (`./mcp/index.js`) that calls Twenty's REST API directly and
exposes these tools to the agent:

| Area       | Tools                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| People     | `find_person_by_email`, `get_person`, `search_people`, `create_person`, `update_person`, `list_people_by_company`                         |
| Companies  | `find_company_by_domain`, `find_company_by_name`, `get_company`, `search_companies`, `create_company`, `update_company`, `list_companies` |
| Notes      | `create_note`, `list_notes_by_person`, `list_notes_by_company`                                                                            |
| Tasks      | `create_task`, `find_tasks`, `update_task`                                                                                                |
| Metadata   | `list_objects`, `get_select_options`                                                                                                      |
| Any object | `list_records`, `get_record`, `create_record`, `update_record`, `delete_record`                                                           |

All tools are prefixed `twenty_`.

The **metadata** + **generic record** tools are what make this generic: the agent calls
`twenty_list_objects` to discover the schema of _your_ workspace (including custom objects,
custom fields, and SELECT options), then reads/writes any of them through the `twenty_*_record`
tools. The typed people/company/note/task tools are a friendly fast-path for the objects every
workspace has.

## Setup

1. In Twenty, go to **Settings → APIs & Webhooks → Generate API Key** and copy the key.
2. In Hay, configure the plugin:
   - **Twenty API URL** — `https://api.twenty.com` for Twenty Cloud, or your self-hosted URL
     (e.g. `https://crm.yourcompany.com`). Do **not** include `/rest`.
   - **API Key** — the key from step 1 (stored encrypted).

Auth is validated with a live round-trip against `${baseUrl}/rest/metadata/objects`.

## MCP server dependencies

The bundled `mcp/` server declares its runtime deps (`@modelcontextprotocol/sdk`, `zod`) in
`mcp/package.json`. The repo's `scripts/build-plugins.sh` runs `npm install` inside `mcp/` at
build time, so `mcp/node_modules` is **gitignored** (not committed). If you build the plugin
manually, install those deps first:

```bash
cd plugins/core/twenty/mcp && npm install --omit=dev
cd ..   && npm install && npm run build   # from repo root via the workspace
```

## Notes on Twenty's API

- Composite fields use a nested shape: `name: { firstName, lastName }`,
  `emails: { primaryEmail }`, `domainName: { primaryLinkUrl }`, `linkedinLink: { primaryLinkUrl }`.
- PATCH **replaces** composite fields wholesale — pass the full nested object when updating one.
- Filters: bracketed operators, comma-separated clauses, combined with `and(...)` / `or(...)`,
  e.g. `name[ilike]:%acme%`, `employees[gte]:100`, `stage[in]:NEW,QUALIFIED`.
- Pagination is cursor-based via `starting_after`; list tools return `nextCursor` + `hasNextPage`.

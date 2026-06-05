# Cal.com plugin

Lets the agent schedule meetings through a connected [Cal.com](https://cal.com) account.
It spawns a local Node MCP server (`mcp/index.js`) that calls the Cal.com **REST API v2**
directly with the account's API key (Bearer auth) — no external MCP server required.

## Capabilities (MCP tools)

| Tool                  | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `get_me`              | The authenticated user (username, email, default timeZone).       |
| `list_event_types`    | Bookable event types and their `id` / `slug` / `lengthInMinutes`. |
| `get_available_slots` | Open slots for an event type within a date range.                 |
| `create_booking`      | Book a meeting on an event type at a given UTC start.             |
| `list_bookings`       | List/filter bookings (find a `uid`).                              |
| `get_booking`         | A single booking by `uid`.                                        |
| `cancel_booking`      | Cancel a booking.                                                 |
| `reschedule_booking`  | Move a booking to a new start time.                               |

Typical flow: `list_event_types` → `get_available_slots` → `create_booking`.

## Configuration

| Field    | Required | Notes                                                                             |
| -------- | -------- | --------------------------------------------------------------------------------- |
| `apiKey` | yes      | Cal.com API key (starts with `cal_`). Settings → Developer → API keys, encrypted. |

## Cal.com API versions

Cal.com's v2 API is pinned by a date-based `cal-api-version` header that differs per
resource. The MCP server pins a known-good version per domain (see `mcp/index.js`):

- event types → `2024-06-14`
- slots → `2024-09-04`
- bookings (create/list/get/cancel/reschedule) and `/me` → `2026-02-25`

## The `mcp/` dependency install

The bundled `mcp/` server is deliberately outside the npm workspace and its
`mcp/node_modules` is gitignored, so it isn't populated by the root install. The platform
now installs it automatically: the SDK presence-checks `mcp/node_modules` and runs
`npm install --omit=dev` on first spawn (`packages/plugin-sdk/sdk/mcp-runtime.ts`), and
`installPlugin`/`needsInstallation` reconcile the gitignored directory with the persisted
install flag. No manual step is required.

(The committed `mcp/package.json` + lockfile pin `@modelcontextprotocol/sdk` and `zod`.)

If you ever need to install it by hand (e.g. to debug the server standalone):

```bash
npm install --omit=dev --prefix plugins/core/calcom/mcp
```

## Build

```bash
# from repo root (so the @hay/plugin-sdk file: link resolves):
npm install --workspace=plugins/core/calcom
npm run build  --workspace=plugins/core/calcom
npm run typecheck:server
```

Produces `dist/index.js` (the plugin entry).

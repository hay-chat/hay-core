# Spacebring plugin (`hay-plugin-spacebring`)

Connects a [Spacebring](https://www.spacebring.com) co-working space to the Hay agent so it can
power a **member chat**: answer FAQs (Wi‑Fi, house rules), find and book meeting rooms / desks,
cancel reservations, surface events, perks and plans, register guest visits, and file support
tickets.

- **Archetype:** A — local bundled MCP server (`mcp/index.js`) spawned over stdio.
- **Auth:** HTTP Basic (the operator's Spacebring API credentials).
- **API base:** `https://api.spacebring.com`.

## Configuration

| Field          | Required | Notes                                                                                            |
| -------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `apiKeyId`     | yes      | Basic-auth username. Spacebring → Settings → Integrations → API.                                 |
| `apiKeySecret` | yes      | Basic-auth password. Stored encrypted.                                                           |
| `locationRef`  | no       | UUID of the location the chat serves. Default for every tool; discover it with `list_locations`. |

> ⚠️ **Auth assumption.** Spacebring's API supports HTTP Basic auth, but its
> [authentication doc](https://www.spacebring.com/docs/api-reference/authentication) could not be
> fetched from the build environment (egress policy). This plugin assumes the Basic credential is
> `base64(apiKeyId:apiKeySecret)`. If Spacebring issues a single combined token, set it as
> `apiKeySecret` and the header construction in `src/index.ts` / `mcp/index.js` is the only thing
> to adjust. Validate against a real key before shipping to the customer.

## Tools (25, member-facing)

The Spacebring OpenAPI surface (~40 paths) was deliberately filtered down to what a member would
ask a chat. Admin/finance endpoints (billing, invoices, credit notes, contracts, discounts,
subscriptions, transactions, shop, floors, registrations, networks) and all admin
create/update/delete + staff/front-desk operations are **excluded**. The full include/exclude
rationale lives in `tasks/spacebring-plugin.md`.

- **Identity / location:** `list_locations`, `find_membership`, `get_membership`
- **Rooms & bookings:** `list_resources`, `get_resource`, `list_bookings`, `create_booking`, `get_booking`, `cancel_booking`
- **Knowledge / FAQ:** `list_guides`, `get_guide`
- **Announcements:** `list_feed_posts`, `get_feed_post`
- **Events:** `list_events`, `get_event`
- **Perks:** `list_benefits`, `get_benefit`
- **Plans:** `list_plans`
- **Guests:** `list_visits`, `create_visit`, `get_visit`, `cancel_visit`
- **Support:** `list_support_tickets`, `create_support_ticket`, `get_support_ticket`

### Notes for the agent

- **Availability is derived.** Spacebring has no availability endpoint — to check whether a room is
  free, call `list_bookings` with the `resourceRef` and a `startDate`/`endDate` window and look for
  overlaps.
- **Member identity.** Basic auth acts as the _organization_, not a member. Resolve the current
  member with `find_membership` (by email) and pass `membershipRefOwner` (bookings) /
  `userRefHost` (visits) / `userRefRequester` (tickets).
- The member's credit and day-pass balances are returned by `find_membership` / `get_membership`.

## Build

```bash
# from the repo root, so the @hay/plugin-sdk file: link resolves
npm install --workspace=plugins/core/spacebring
npm run build  --workspace=plugins/core/spacebring   # tsc -> dist/index.js
npm run typecheck:server
```

The bundled MCP server lives in `mcp/` and is **not** part of the TS build or the npm workspace.
Its dependencies (`@modelcontextprotocol/sdk`, `zod`) are installed separately — `scripts/build-plugins.sh`
and the plugin manager both run `npm install` inside `mcp/` when `mcp/node_modules` is missing.
`mcp/package.json` + `mcp/package-lock.json` are committed; `mcp/node_modules` is gitignored.

## Follow-ups

- Add a `thumbnail.jpg` (core references `./thumbnail.jpg` for the marketplace icon).
- Confirm the Basic-auth credential format against Spacebring's auth docs.
- Possible future tools if the customer wants them: shop products, benefit applications,
  event tickets, visitor check-in/out.

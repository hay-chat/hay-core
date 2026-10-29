# Spacebring plugin (`hay-plugin-spacebring`)

Connects a [Spacebring](https://www.spacebring.com) co-working space to the Hay agent so it can
run a **member chat**: book, move and cancel rooms and desks, invite guests, report problems to
the team, and answer house questions (Wi‑Fi, rules, events, perks, plans).

- **Archetype:** A — local bundled MCP server (`mcp/`) spawned over stdio.
- **Auth:** HTTP Basic (the operator's Spacebring API credentials).
- **API base:** `https://api.spacebring.com`.

## Configuration

| Field          | Required | Notes                                                                                     |
| -------------- | -------- | ----------------------------------------------------------------------------------------- |
| `apiKeyId`     | yes      | Basic-auth username. Spacebring → Settings → Integrations → API.                          |
| `apiKeySecret` | yes      | Basic-auth password. Stored encrypted.                                                    |
| `locationRef`  | no       | Name or id of the location the chat serves. Not needed when the network has one location. |
| `timeZone`     | no       | Advanced. IANA zone used when Spacebring reports none for the location (default UTC).     |

## Tools: playbook steps, not endpoints

Each tool is one step a support playbook would name. It resolves what the member said (email,
room name, "tomorrow at 2pm") into Spacebring ids and UTC times, runs the requests it needs in
order, enforces the rules, and answers with a `summary` the agent can relay. Failures are
`ToolError`s whose message tells the agent what to ask or do next. Design rules:
`.claude/skills/build-plugin/reference/tool-design.md`.

| Tool                               | Risk        | Playbook step                           | Spacebring calls                                       |
| ---------------------------------- | ----------- | --------------------------------------- | ------------------------------------------------------ |
| `spacebring_get_member`            | read        | "What have I booked? How many credits?" | membership by email + bookings + visits + tickets      |
| `spacebring_find_available_spaces` | read        | "Is a room free at 3pm for 5 people?"   | resources + overlapping bookings                       |
| `spacebring_book_space`            | other_write | Book a room/desk                        | membership, resources, bookings (conflict check), POST |
| `spacebring_move_booking`          | other_write | Change a booking's time/space           | … POST new booking, **then** DELETE old                |
| `spacebring_cancel_booking`        | destructive | Cancel my booking                       | membership, bookings (ownership), DELETE               |
| `spacebring_invite_guest`          | other_write | "I have a visitor tomorrow"             | membership (host), POST visit                          |
| `spacebring_cancel_guest_visit`    | other_write | Cancel a visitor                        | membership, visits (ownership), DELETE                 |
| `spacebring_report_issue`          | note        | "The AC is broken"                      | membership (optional), POST ticket (type inferred)     |
| `spacebring_search_guides`         | read        | "What's the Wi‑Fi password?"            | guides, ranked, full text of best matches              |
| `spacebring_whats_on`              | read        | "Any events this week? Any news?"       | events + feed posts                                    |
| `spacebring_list_perks`            | read        | "Do members get discounts?"             | benefits                                               |
| `spacebring_list_plans`            | read        | "How much is a hot desk?"               | plans                                                  |

Rules the tools enforce (not the prompt): the slot is free (Spacebring has no availability
endpoint, so overlaps are computed from bookings), the time is in the future, and a member can
only cancel or move **their own** bookings and guest visits (matched by the email they give).
Ambiguous room or location names return the candidates instead of a guess.

Out of scope on purpose: billing, invoices, contracts, discounts, subscriptions, transactions,
shop, floors, registrations, and all admin/staff operations. The original endpoint triage is in
`tasks/spacebring-plugin.md`.

## Build & test

```bash
# from the repo root, so the @hay/plugin-sdk file: link resolves
npm install --workspace=plugins/core/spacebring
npm run build --workspace=plugins/core/spacebring   # tsc -> dist/index.js
npm test --workspace=plugins/core/spacebring        # vitest: mcp/tests
```

`mcp/` is plain CommonJS outside the TS build. Its dependencies (`@modelcontextprotocol/sdk`,
`zod`) are installed by `scripts/build-plugins.sh` / the plugin manager when `mcp/node_modules`
is missing; `mcp/package-lock.json` is committed, `mcp/node_modules` is gitignored.

## Unverified against a live account

Spacebring's docs host was unreachable from the build environment, so these come from the
OpenAPI notes in `tasks/spacebring-plugin.md` and are read tolerantly in `mcp/lib/spacebring.js`:

- Basic credential = `base64(apiKeyId:apiKeySecret)`.
- List responses wrap items under the resource name (`{ bookings: [...], nextPageToken }`),
  single reads under the singular (`{ booking: {...} }`); bare shapes are accepted too.
- Location time zone field (`timeZone`/`timezone`); otherwise the `timeZone` config, then UTC.
- `POST /visitors/visits/v1` accepts `userRefHost` to attribute the guest to the member.
- Membership balances (`credits`, `dayPasses`) and ticket `status` values.

Run one round trip per tool against a real workspace before shipping.

## Follow-ups

- Add a `thumbnail.jpg` (core references `./thumbnail.jpg` for the marketplace icon).
- Opening hours: bookings outside a resource's schedule are refused by Spacebring and relayed;
  `find_available_spaces` does not read the schedule yet.

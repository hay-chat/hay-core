# Spacebring MCP plugin — plan & endpoint filtering

## Goal / acceptance criteria

Build `hay-plugin-spacebring` (Archetype A — local bundled MCP over stdio) so the Hay
agent can power a co-working space member chat: answer FAQs (Wi‑Fi, house rules), see room
availability, book/cancel rooms, and a few high-value extras. **Done when:** plugin builds
(`npm run build --workspace=plugins/core/spacebring`), `typecheck:server` passes, and the
curated tools appear in `/mcp/list-tools`.

## Decisions / assumptions

- **Archetype A** (local Node MCP server in `mcp/`, native `fetch`, only deps `@modelcontextprotocol/sdk` + `zod`).
- **Auth = HTTP Basic** (operator's Spacebring API credentials). Modeled as two config fields
  `apiKeyId` + `apiKeySecret` (Basic `base64(id:secret)`). ⚠️ The exact Basic username/password
  semantics live in Spacebring's auth docs (host `www.spacebring.com` is blocked by this
  environment's egress policy, so it could not be fetched). If their key is a single token, the
  fields collapse trivially. Easy to adjust.
- **`locationRef`** is required by almost every endpoint → a `locationRef` config field provides
  the default location; every tool also accepts an optional `locationRef` override.
- **Member identity:** Basic auth acts as the _organization_, not a specific member. Member-scoped
  actions (a member's bookings, registering their guest) take a `membershipRef`/`userRef` param.
  `find_membership` (by email) is the bridge the agent uses to resolve the current member.
- **No availability endpoint exists** — availability is derived: `list_resources` (schedule) +
  `list_bookings` (resource + date window) → agent computes free slots. Encoded in tool descriptions.
- Read-only first; the only writes exposed are genuinely member-initiated:
  `create_booking`, `cancel_booking`, `create_visit`, `cancel_visit`, `create_support_ticket`.

## Endpoint filtering (full spec triaged by tag)

INCLUDE = belongs in a member chat. EXCLUDE = admin/finance/back-office/not chat-shaped.

| Tag           | Endpoint                                       | Decision                                  | Why                                              |
| ------------- | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Locations     | GET /locations/v1                              | list_locations                            | resolve location names → locationRef             |
| Community     | GET /community/memberships/v1 (?userEmail)     | find_membership                           | identity bridge; returns credits/dayPasses       |
| Community     | GET /community/memberships/v1/{id}             | get_membership                            | member detail + credit balance                   |
| Community     | companies, deleted, create/update/delete       | EXCLUDE                                   | admin / CRM                                      |
| Resources     | GET /resources/v1                              | list_resources                            | "what rooms/desks exist"                         |
| Resources     | GET /resources/v1/{id}                         | get_resource                              | room detail (capacity, schedule)                 |
| Resources     | GET /resources/bookings/v1                     | list_bookings                             | availability window + a member's bookings        |
| Resources     | POST /resources/bookings/v1                    | create_booking                            | reserve a room                                   |
| Resources     | GET /resources/bookings/v1/{id}                | get_booking                               | booking detail                                   |
| Resources     | DELETE /resources/bookings/v1/{id}             | cancel_booking                            | cancel a reservation                             |
| Resources     | POST/PATCH resource                            | EXCLUDE                                   | admin (space configuration)                      |
| Guides        | GET /guides/v1, /{id}                          | list_guides / get_guide                   | knowledge base: Wi‑Fi, house rules, how‑tos      |
| Guides        | create/patch/delete                            | EXCLUDE                                   | admin authoring                                  |
| Feed          | GET /feed/posts/v1, /{id}                      | list_feed_posts / get_feed_post           | community announcements / "any news?"            |
| Feed          | create/update/delete/comments/likes            | EXCLUDE                                   | social writes, out of scope                      |
| Events        | GET /events/v1, /{id}                          | list_events / get_event                   | upcoming community events                        |
| Events        | create/delete/cancel/copy, tickets             | EXCLUDE                                   | admin; tickets org-wide under Basic auth         |
| Benefits      | GET /benefits/v1, /{id}                        | list_benefits / get_benefit               | member perks/discounts                           |
| Benefits      | categories, applications, create/update/delete | EXCLUDE                                   | browse-aid / writes / admin (future)             |
| Plans         | GET /plans/v1                                  | list_plans                                | membership tiers & pricing (prospect/member Q)   |
| Plans         | get/create/update/delete                       | EXCLUDE                                   | list already returns full plan objects           |
| Visitors      | GET /visitors/visits/v1, /{id}                 | list_visits / get_visit                   | "who's visiting me"                              |
| Visitors      | POST /visitors/visits/v1                       | create_visit                              | register/invite a guest                          |
| Visitors      | DELETE /visitors/visits/v1/{id}                | cancel_visit                              | cancel a guest visit                             |
| Visitors      | update, checkin/checkout, requests, contacts   | EXCLUDE                                   | front-desk / host-approval / address book        |
| Support       | GET /support/tickets/v1, /{id}                 | list_support_tickets / get_support_ticket | check a reported issue                           |
| Support       | POST /support/tickets/v1                       | create_support_ticket                     | "report the AC is broken / printer down"         |
| Support       | assignee/status/type/comment                   | EXCLUDE                                   | staff-side operations                            |
| AltCurrencies | all                                            | EXCLUDE                                   | finance config                                   |
| Billing       | invoices, credit notes, items                  | EXCLUDE                                   | finance/admin                                    |
| Contracts     | all                                            | EXCLUDE                                   | legal/finance                                    |
| Discounts     | coupons, promocodes, redemptions               | EXCLUDE                                   | admin marketing                                  |
| Floors        | all                                            | EXCLUDE                                   | raw floor-plan JSON, not chat-friendly           |
| Networks      | GET /networks/v1                               | EXCLUDE                                   | Basic auth implies the network                   |
| Registrations | all                                            | EXCLUDE                                   | network-wide admin                               |
| Shop          | products/categories/orders                     | EXCLUDE                                   | secondary; revisit after basics                  |
| Subscriptions | all                                            | EXCLUDE                                   | billing/admin                                    |
| Transactions  | credits/day_passes/money/balances              | EXCLUDE                                   | finance history; credit balance is on membership |

### Tool set — superseded

The first cut exposed the 25 INCLUDE endpoints above as 25 tools (one per endpoint). That was
replaced by **12 playbook-step tools** that compose these endpoints inside the server (resolve
member/space by name, compute availability, check ownership, serialise writes). The mapping is in
`plugins/core/spacebring/README.md`; the design rules that drove it are in
`.claude/skills/build-plugin/reference/tool-design.md`. The table above is still the record of
which endpoints are in scope.

## Results

- v1 (2026-06-25): 25 one-per-endpoint tools; strict `tsc` build; MCP smoke test.
- v2 (2026-10-29): rewritten as 12 playbook tools in `mcp/{lib,tools}` on the shared
  `@hay/plugin-sdk` tool-errors/tool-risk/identity helpers; time handling in the location's
  zone; `timeZone` advanced config; vitest suite (`mcp/tests`, 46 tests) covering request order,
  refusal paths, "no write when a check fails" and risk classification.
- Still unverified against a live workspace (docs host blocked by egress): see README
  "Unverified against a live account".

## Working notes

- Spec base URL: `https://api.spacebring.com`. Pagination via `nextPageToken` + `limit` (max 100).
- Date filters are bracketed query params: `startDate[gte]`, `endDate[lte]`, etc.
- `spacebring-network-id` header only needed for OAuth/bearer — not for Basic auth.
- Resource/booking `types`: hotDesk, dedicatedDesk, office, parkingLot, room (comma-separated).

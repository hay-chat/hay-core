# Raise a helpdesk ticket when nobody can take the hand-off (2026-10-29)

## Goal

On the agent page, "when no one is available" offers a structured choice next to the free-text
instructions: **Create a ticket** in a connected helpdesk (Zendesk first). The merchant prefills
fields read from their own account (group, priority, type, tags, custom fields). When a hand-off
happens and nobody can take it (closed or nobody online), the AI makes sure it has a way to reach
the customer, raises the ticket with a summary and the transcript, tells the customer the team
will get back to them, and the conversation is closed instead of waiting in the queue.

## Design

- **SDK capability `tickets`** (core never names a plugin). Core-only worker routes:
  - `POST /tickets/form` → `{ fields: TicketFormField[] }` from the connected account.
  - `POST /tickets/create` → `{ ok: true, ticketId, ticketUrl? } | { ok: false, code, message }`.
- **Agent column** `human_handoff_unavailable_ticket` jsonb `{ pluginId, fields }`; non-null = ticket mode.
  The free-text instructions are kept so switching back loses nothing.
- **Server**: `handoff-tickets.service.ts` (providers, form, create); tRPC `agents.ticketProviders` /
  `agents.ticketForm`; core tool `create_ticket` (only works while a ticket hand-off is active, needs
  email or phone); `run.ts` unavailable hand-off injects ticket instructions instead of the free text.
  After the ticket is created the conversation is resolved with reason `ticket_created`.
- **Zendesk**: `tickets` capability; form from groups, ticket_fields; create via `/api/v2/tickets.json`
  with the transcript as an internal note.
- **Dashboard**: option cards (instructions / create ticket) + field form on `pages/agents/[id].vue`.

## Checklist

- [x] SDK types + capability lists + route constants
- [x] Zendesk routes + tests
- [x] Migration + entity + agent routes/service
- [x] Ticket service + core tool + handoff branch + tests
- [x] Dashboard UI + i18n (en, pt-BR)
- [x] Verify: server typecheck + jest (new tests), SDK vitest, zendesk vitest, dashboard typecheck + lint

## Working notes

- Within business hours a `pending-human` conversation silences the AI (run.ts). While a ticket is
  `requested` the AI keeps answering, so it can collect the email.
- The conversation still flips to `pending-human` at the hand-off (team alerts, channel `/escalate`):
  it is the fallback when the customer never gives an email or the helpdesk refuses the ticket.
- Without an email (phone-only customers) Zendesk gets no requester; the phone is in the note.
- `/tickets/*` is in the proxy's worker-internal list: only core can reach it.

## Results

- SDK: `tickets` capability, `TICKET_FORM_ROUTE` / `TICKET_CREATE_ROUTE`, `types/tickets.ts`.
- Zendesk: `src/tickets.ts` (form from assignable groups, ticket fields, ticket forms; create as an
  internal note tagged `hay_chat_handoff`), routes in `src/index.ts`, 7 vitest cases.
- Server: `agents.human_handoff_unavailable_ticket` (migration 1785950000000),
  `services/handoff-tickets/handoff-tickets.service.ts`, core tool `create_ticket`, hand-off branch
  and post-turn close in `orchestrator/run.ts`, `agents.ticketProviders` / `agents.ticketForm`.
- Dashboard: `components/agents/HandoffTicketSettings.vue` on the agent page, capability card.
- Verified: server `tsc` clean; jest handoff-tickets (9), orchestrator + agents routes (21 suites,
  123 tests), plugin proxy (32); SDK vitest 245; Zendesk vitest 10; dashboard `nuxt typecheck` and
  root `npm run lint` clean; migration SQL up/down on Postgres 16.
- Not verified: an end-to-end run against a real Zendesk account and live LLM.

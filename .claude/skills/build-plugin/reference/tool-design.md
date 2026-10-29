# Designing MCP Tools for Hay

How to choose and shape the tools a plugin exposes to the agent. Read this **before** writing
`mcp/`. It applies to every archetype A plugin (and to whatever you let through `toolRisk` on a
hosted server).

## The rule

**A tool is a step in a playbook, not an endpoint in an API.**

Our first plugins mirrored the provider's API 1:1: `list_resources`, `get_resource`,
`list_bookings`, `create_booking`… The agent then had to chain four calls, carry UUIDs between
them, guess query syntax (`startDate[gte]`), and work out business rules (is the slot free? is
this the member's booking?) from raw JSON. It does that badly, slowly and expensively, and a
merchant writing a playbook cannot point at any of those tools and say "do this step".

Instead, the tools should be the actions a support playbook says out loud:

> _Book a meeting room_: ask for date, time and headcount → **find available spaces** → confirm
> with the member → **book the space**.

Every bold verb is one tool. Whatever the platform needs underneath (resolve the member by email,
find the room by name, read existing bookings, check the overlap, then POST) happens **inside**
that tool.

## 1. Start from playbooks, not from the spec

1. Write down the 5–15 conversations the business actually has with its customers ("where is my
   order", "book a room", "what's the Wi‑Fi password", "the AC is broken").
2. Write each as a playbook: the steps an agent takes. Each step that touches the platform is a
   tool candidate. Steps that are just talking ("confirm with the member") are not tools.
3. Merge candidates that need the same data. Drop anything no playbook needs.
4. Only now open the API spec, to find which endpoints each tool has to call.

Endpoints no playbook needs (admin, billing configuration, staff operations, CRUD on settings)
stay out. A typical plugin ends up with **6–15 tools**. If you have 25, you are probably mirroring
the API.

## 2. One tool per intent, many requests inside

A tool does the whole step. That routinely means serialising several requests:

- **Resolve → check → act → confirm.** `book_space` looks up the member by email, resolves the
  room by name, reads bookings in the window, refuses if the slot overlaps, then creates the
  booking and returns a confirmation sentence.
- **Merge reads that answer one question.** `get_order` returns the order + payments +
  fulfilments + a `supportSummary` (cancellable? refundable? stale tracking?) in one call. A
  list-then-get pair becomes one search tool that returns the full text of the best matches.
- **Run independent reads in parallel** (`Promise.all`), dependent ones in order.
- **Order writes so a failure halfway leaves the customer better off.** Moving a booking creates
  the new booking first and only then deletes the old one; if the delete fails, the member still
  has a room and the tool says exactly which booking to clean up.
- **Never replay a non-idempotent request** after a timeout or 5xx (it may have gone through).
  Return `OUTCOME_UNKNOWN` and tell the agent to check before retrying.

Name tools `<platform>_<verb>_<thing>` in playbook language: `spacebring_book_space`,
`wix_cancel_order`, `shopify_get_order_tracking`. Not `post_bookings_v1`.

## 3. Be permissive on input

The agent passes what the customer said. The tool does the normalising, so a playbook works the
first time instead of after three failed calls.

- **Accept the identifiers customers know.** Email instead of member UUID, order number instead of
  internal id, room _name_ instead of resource UUID. Resolve them inside the tool. Accept ids too.
- **Match leniently.** Trim, case-fold, strip accents, accept partial names (`"orange"` →
  "Orange Room"). Map synonyms onto enums (`"wifi"`, `"internet down"` → `internet`) and fall back
  to a safe default (`other`) instead of rejecting.
- **Accept equivalent shapes.** `end` **or** `duration_minutes`; a date and a time as separate
  fields; ISO with or without an offset (read without an offset as the location's local time, and
  say which time zone you used).
- **Default what you can.** The configured location; the only location when there is just one;
  "upcoming" for list windows; 60 minutes for a meeting.
- **Keep the schema small and described.** Every param gets `.describe()` with an example. Prefer
  `z.string()` + server-side parsing over strict zod formats that reject reasonable input
  (`z.string().email()` refuses `" Ana@x.com "`; trim and validate yourself).

Be permissive about **format**, never about **meaning**: if two rooms match `"room"`, do not pick
one. Return the candidates and let the agent ask.

## 4. Be strict on effects

- **Enforce business rules in the tool, not the prompt.** Slot free, inside opening hours,
  order not yet shipped, refund ≤ remaining balance, booking belongs to the member asking. The
  prompt can be talked out of a rule; the tool cannot.
- **Check ownership with what the customer gave you.** Cancel/move only a booking whose owner
  matches the member email the customer supplied (see `@hay/plugin-sdk/identity` for
  email/phone matching).
- **Classify every tool's risk** (`tool-risk.js`; see SKILL.md). Reads → `read`; writes get the
  category core should treat them as (`cancel`, `refund`, `destructive`, `other_write`, …).

## 5. Talk back to the model

Tool output is the agent's only view of what happened. Write it for the agent.

- **Errors are instructions.** Throw a `ToolError` from `@hay/plugin-sdk/tool-errors` with a code
  (`BAD_INPUT`, `NOT_FOUND`, `PRECONDITION`, `OUTCOME_UNKNOWN`, …) and a message that says what
  to do next:
  - ✗ `Spacebring POST /resources/bookings/v1 failed: 409`
  - ✓ `Orange Room is already booked 14:00–15:00. Free nearby: 15:00–17:30. Offer one of those, or call spacebring_find_available_spaces for other rooms.`
- **Ambiguity is a result, not a failure.** Return the candidates (`details.matches`) and say
  "ask the member which one".
- **Successes carry a `summary`** the agent can relay almost verbatim ("Booked Orange Room for
  Ana on Tue 4 Nov, 14:00–15:00 (Europe/Lisbon).") and, where useful, a `next` hint ("Credits are
  deducted by Spacebring; check spacebring_get_member if the member asks about their balance.").
- **Translate provider errors.** Pull the human message out of the provider's error body;
  map HTTP status to a code with `codeForHttpStatus`. Never dump raw bodies or stack traces.

## 6. Shape output for a conversation

- Return the fields a reply needs, not the provider's object. Strip links, relationships,
  internal flags and nulls.
- Times in the location's time zone, labelled. Money with its currency.
- Cap lists (10–20 items) and say when there are more, with how to narrow.
- Include the ids the next tool will need, but the agent should never _have_ to read them aloud.

## 7. Test the flow, not the endpoint

Per tool, with a `fetch` stub (see `plugins/core/wix/mcp/tests/harness.js`):

- the happy path issues the expected requests **in order** and returns the summary;
- each refusal path (slot taken, not the owner, ambiguous name, nothing found) returns the right
  code and a message that names the next step;
- a write never runs when a check fails (assert the POST/DELETE was **not** called);
- `tool-risk.test.js`: every registered tool is classified.

## Checklist

- [ ] Every tool maps to a playbook step a merchant would write; none exists "because the API has it".
- [ ] No tool requires an id the customer cannot give; lookups by email/number/name happen inside.
- [ ] Multi-request flows are serialised in the tool, writes ordered so a partial failure is safe.
- [ ] Input is normalised (case, whitespace, synonyms, equivalent shapes) with sensible defaults.
- [ ] Ambiguous input returns candidates, never a guess.
- [ ] Business rules and ownership are enforced in code before any write.
- [ ] Every error is a `ToolError` whose message tells the agent what to do next.
- [ ] Every success has a relayable `summary`; output is trimmed, localised and capped.
- [ ] Every tool has a risk class; tests cover happy path, refusals and "write not called".

## Before / after: Spacebring

| Before (1:1, 25 tools)                                                           | After (playbook steps, 12 tools)                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| `find_membership`, `get_membership`, `list_bookings`, `list_visits`              | `spacebring_get_member`                           |
| `list_resources`, `get_resource`, `list_bookings` (+ overlap maths in the model) | `spacebring_find_available_spaces`                |
| `find_membership` → `list_resources` → `list_bookings` → `create_booking`        | `spacebring_book_space`                           |
| `create_booking` + `cancel_booking` (and hope the order is right)                | `spacebring_move_booking`                         |
| `get_booking` + `cancel_booking` (no ownership check)                            | `spacebring_cancel_booking`                       |
| `list_guides` + `get_guide`                                                      | `spacebring_search_guides`                        |
| `list_events`, `get_event`, `list_feed_posts`, `get_feed_post`                   | `spacebring_whats_on`                             |
| `list_benefits`, `get_benefit` · `list_plans`                                    | `spacebring_list_perks` · `_list_plans`           |
| `find_membership` → `create_visit` · `get_visit` + `cancel_visit`                | `spacebring_invite_guest` · `_cancel_guest_visit` |
| `find_membership` → `create_support_ticket` (exact enum)                         | `spacebring_report_issue`                         |

See `plugins/core/spacebring/mcp/` for the implementation.

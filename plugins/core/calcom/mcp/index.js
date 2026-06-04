#!/usr/bin/env node
/**
 * Local Node MCP server for Cal.com.
 *
 * Each tool calls the Cal.com REST API v2 (https://api.cal.com/v2) directly
 * using the CALCOM_API_KEY env var as a Bearer token.
 *
 * Cal.com pins its v2 API behind a date-based `cal-api-version` header, and the
 * required value differs per resource. We pin a known-good version per domain
 * (see the *_VERSION constants) rather than relying on the endpoint default.
 *
 * Conventions (mirrors the klaviyo reference plugin):
 *  - Native `fetch`, one shared `calApi()` request helper for auth + errors.
 *  - `ok()` / `fail()` build the MCP content envelope consistently.
 *  - stdout is reserved for JSON-RPC — all logging goes to console.error.
 *  - Every tool has a zod schema with `.describe()` on each param and a rich
 *    description with cross-tool hints.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const CALCOM_BASE_URL = "https://api.cal.com/v2";

// Per-resource cal-api-version pins. Each Cal.com v2 resource validates this
// header independently; using the documented version per domain keeps response
// shapes stable.
const EVENT_TYPES_VERSION = "2024-06-14";
const SLOTS_VERSION = "2024-09-04";
const BOOKINGS_VERSION = "2026-02-25";

const API_KEY = process.env.CALCOM_API_KEY;
if (!API_KEY) {
  console.error("ERROR: CALCOM_API_KEY environment variable is required");
  process.exit(1);
}

/**
 * Call the Cal.com REST API v2.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE).
 * @param {string} path - Path beginning with "/", relative to CALCOM_BASE_URL.
 * @param {object} [options]
 * @param {string} options.version - Required `cal-api-version` header value.
 * @param {object} [options.query] - Query params; arrays become comma-separated.
 * @param {object} [options.body] - Optional JSON request body.
 * @returns {Promise<any>} Parsed JSON response body (or `null` for empty bodies).
 */
async function calApi(method, path, { version, query, body } = {}) {
  const url = new URL(CALCOM_BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        url.searchParams.set(key, value.join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: "application/json",
    "cal-api-version": version,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Cal.com API ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

/** Build a JSON tool response. */
function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/** Build a JSON tool response wrapping an error. */
function fail(err) {
  return {
    content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
    isError: true,
  };
}

const server = new McpServer({
  name: "calcom-mcp-server",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

server.tool(
  "get_me",
  `Get the authenticated Cal.com user: id, username, email, name, and default timeZone.

Use this first when you need the account's username (for list_event_types) or its
default timeZone (a sensible fallback for the attendee/slot timeZone when the user
hasn't given one).`,
  {},
  async () => {
    try {
      return ok(await calApi("GET", "/me", { version: BOOKINGS_VERSION }));
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

server.tool(
  "list_event_types",
  `List bookable event types. Each event type is a meeting template with an \`id\`,
\`slug\`, \`title\`, and \`lengthInMinutes\`.

This is the starting point for booking: you need an event type's \`id\` to call
get_available_slots and create_booking. If you don't know the account username,
call get_me first, then pass its \`username\` here.`,
  {
    username: z
      .string()
      .optional()
      .describe(
        "Cal.com username whose event types to list (e.g. 'jane'). Get it from get_me. If omitted, returns event types accessible to the API key.",
      ),
    eventSlug: z
      .string()
      .optional()
      .describe("Filter to a single event type by its slug (requires username)."),
  },
  async ({ username, eventSlug }) => {
    try {
      const response = await calApi("GET", "/event-types", {
        version: EVENT_TYPES_VERSION,
        query: { username, eventSlug },
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

server.tool(
  "get_available_slots",
  `Get open time slots for an event type within a date range. Returns available
\`start\` times grouped by date — use one of these exact \`start\` values when
calling create_booking so you never book an unavailable time.

Get the \`eventTypeId\` from list_event_types first.`,
  {
    eventTypeId: z
      .number()
      .int()
      .describe("The event type id to check availability for (from list_event_types)."),
    start: z
      .string()
      .describe(
        "Start of the search range, ISO 8601 (e.g. '2026-06-10' or '2026-06-10T09:00:00Z'). Interpreted in `timeZone`.",
      ),
    end: z
      .string()
      .describe("End of the search range, ISO 8601. Keep the range to a few weeks at most."),
    timeZone: z
      .string()
      .optional()
      .describe(
        "IANA timezone for the returned slots and range, e.g. 'America/New_York'. Defaults to the event type's timezone. Use the attendee's timezone when known.",
      ),
  },
  async ({ eventTypeId, start, end, timeZone }) => {
    try {
      const response = await calApi("GET", "/slots", {
        version: SLOTS_VERSION,
        query: { eventTypeId, start, end, timeZone },
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

server.tool(
  "create_booking",
  `Book a meeting (schedule an appointment) on an event type.

Flow: list_event_types → get_available_slots → create_booking using one of the
returned slot \`start\` values. The \`start\` MUST be in UTC (ISO 8601, ending in
'Z'). On success, returns the booking including its \`uid\` — keep that uid to
later reschedule or cancel.`,
  {
    eventTypeId: z.number().int().describe("The event type id to book (from list_event_types)."),
    start: z
      .string()
      .describe(
        "Meeting start time in UTC, ISO 8601 ending in 'Z' (e.g. '2026-06-10T15:00:00Z'). Use an exact slot start from get_available_slots.",
      ),
    attendeeName: z.string().describe("Full name of the person being booked."),
    attendeeEmail: z.string().describe("Email address of the attendee."),
    attendeeTimeZone: z
      .string()
      .describe("Attendee's IANA timezone, e.g. 'Europe/London'. Required by Cal.com."),
    attendeePhoneNumber: z
      .string()
      .optional()
      .describe(
        "Attendee phone in E.164 format. Required only if the event type sends SMS reminders.",
      ),
    guests: z.array(z.string()).optional().describe("Additional guest email addresses to invite."),
    lengthInMinutes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Override duration, only if the event type allows multiple durations."),
    location: z
      .record(z.any())
      .optional()
      .describe(
        "Optional location object per Cal.com's booking API (e.g. { type: 'attendeeAddress', address: '...' } or an integration location). Omit to use the event type default.",
      ),
    metadata: z
      .record(z.any())
      .optional()
      .describe("Optional custom key-value metadata to attach to the booking."),
  },
  async (input) => {
    try {
      const body = {
        start: input.start,
        eventTypeId: input.eventTypeId,
        attendee: {
          name: input.attendeeName,
          email: input.attendeeEmail,
          timeZone: input.attendeeTimeZone,
        },
      };
      if (input.attendeePhoneNumber) body.attendee.phoneNumber = input.attendeePhoneNumber;
      if (input.guests && input.guests.length) body.guests = input.guests;
      if (input.lengthInMinutes) body.lengthInMinutes = input.lengthInMinutes;
      if (input.location) body.location = input.location;
      if (input.metadata) body.metadata = input.metadata;

      const response = await calApi("POST", "/bookings", {
        version: BOOKINGS_VERSION,
        body,
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "list_bookings",
  `List bookings, optionally filtered. Use this to find a booking's \`uid\` before
rescheduling or cancelling, or to check someone's upcoming meetings.`,
  {
    status: z
      .array(z.enum(["upcoming", "recurring", "past", "cancelled", "unconfirmed"]))
      .optional()
      .describe("Filter by booking status. Omit to return all."),
    attendeeEmail: z
      .string()
      .optional()
      .describe("Only return bookings that include this attendee email."),
    eventTypeId: z
      .number()
      .int()
      .optional()
      .describe("Only return bookings for this event type id."),
    take: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .describe("Max number of bookings to return (page size). Default 100."),
    skip: z.number().int().min(0).optional().describe("Number of bookings to skip (for paging)."),
  },
  async ({ status, attendeeEmail, eventTypeId, take, skip }) => {
    try {
      const response = await calApi("GET", "/bookings", {
        version: BOOKINGS_VERSION,
        query: { status, attendeeEmail, eventTypeId, take, skip },
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_booking",
  `Get a single booking by its \`uid\`, including status, start/end, attendees, and
meeting location/URL.`,
  {
    bookingUid: z.string().describe("The booking uid (from create_booking or list_bookings)."),
  },
  async ({ bookingUid }) => {
    try {
      const response = await calApi("GET", `/bookings/${bookingUid}`, {
        version: BOOKINGS_VERSION,
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "cancel_booking",
  `Cancel a booking by its \`uid\`. Only accepted or pending bookings can be
cancelled.`,
  {
    bookingUid: z.string().describe("The booking uid to cancel (from list_bookings/get_booking)."),
    cancellationReason: z
      .string()
      .optional()
      .describe("Optional reason shown to the attendee and recorded on the booking."),
  },
  async ({ bookingUid, cancellationReason }) => {
    try {
      const response = await calApi("POST", `/bookings/${bookingUid}/cancel`, {
        version: BOOKINGS_VERSION,
        body: cancellationReason ? { cancellationReason } : {},
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "reschedule_booking",
  `Reschedule a booking to a new start time. Creates a new booking linked to the
original and cancels the old one. Only accepted or pending bookings can be
rescheduled. Use get_available_slots to pick a valid new \`start\`.`,
  {
    bookingUid: z.string().describe("The booking uid to reschedule."),
    start: z
      .string()
      .describe(
        "New meeting start time in UTC, ISO 8601 ending in 'Z' (e.g. '2026-06-11T15:00:00Z'). Use a slot from get_available_slots.",
      ),
    reschedulingReason: z
      .string()
      .optional()
      .describe("Optional reason for the reschedule, shown to the attendee."),
  },
  async ({ bookingUid, start, reschedulingReason }) => {
    try {
      const body = { start };
      if (reschedulingReason) body.reschedulingReason = reschedulingReason;
      const response = await calApi("POST", `/bookings/${bookingUid}/reschedule`, {
        version: BOOKINGS_VERSION,
        body,
      });
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[calcom-mcp] server connected over stdio.");
}

main().catch((err) => {
  console.error("Cal.com MCP server failed to start:", err);
  process.exit(1);
});

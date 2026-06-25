/**
 * Local MCP server for Spacebring  (plugins/core/spacebring/mcp/index.js)
 *
 * Plain runtime CommonJS (NOT compiled from TS — tsconfig excludes mcp/).
 * Spawned over stdio by the entry's ctx.mcp.startLocalStdio({ cwd: "./mcp" }).
 *
 *  - Uses @modelcontextprotocol/sdk — no hand-rolled JSON-RPC.
 *  - Reads creds from process.env (SPACEBRING_API_KEY_ID / _SECRET); hard-exit if missing.
 *  - stdout is reserved for JSON-RPC — logs go to console.error only.
 *  - One shared api() helper builds the Basic-auth header + normalizes errors.
 *  - Every tool returns { content: [{ type: "text", text }] }, isError on failure.
 *
 * Scope: a member-facing co-working assistant. Read tools for info (guides/FAQ, rooms,
 * events, perks, plans), plus the genuinely member-initiated writes (book/cancel a room,
 * register/cancel a guest, file a support ticket). Admin/finance endpoints are excluded.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API_KEY_ID = process.env.SPACEBRING_API_KEY_ID;
const API_KEY_SECRET = process.env.SPACEBRING_API_KEY_SECRET;
const DEFAULT_LOCATION_REF = process.env.SPACEBRING_LOCATION_REF || "";

if (!API_KEY_ID || !API_KEY_SECRET) {
  console.error(
    "[spacebring-mcp] SPACEBRING_API_KEY_ID / SPACEBRING_API_KEY_SECRET missing — cannot start.",
  );
  process.exit(1);
}

const BASE_URL = "https://api.spacebring.com";
const AUTH_HEADER = "Basic " + Buffer.from(`${API_KEY_ID}:${API_KEY_SECRET}`).toString("base64");

/** Single request helper: centralizes Basic auth + query building + error normalization. */
async function api(method, path, { query, body } = {}) {
  const url = new URL(BASE_URL + path);
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

  const headers = { Authorization: AUTH_HEADER, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Spacebring ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

/** Resolve the location, falling back to the configured default. */
function requireLocation(locationRef) {
  const value = locationRef || DEFAULT_LOCATION_REF;
  if (!value) {
    throw new Error(
      "No locationRef provided and no default location is configured. Call list_locations to find a location id, or set a default location in the plugin settings.",
    );
  }
  return value;
}

/** Standard MCP tool responses. */
const ok = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});
const fail = (err) => ({
  content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
  isError: true,
});

const server = new McpServer({ name: "spacebring-mcp-server", version: "1.0.0" });

// Shared schema fragments reused across tools.
const limit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Maximum number of items to return (1–100, default 25).");
const nextPageToken = z
  .string()
  .optional()
  .describe(
    "Pagination cursor: pass the nextPageToken from a previous response to fetch the next page.",
  );
const locationRefOpt = z
  .string()
  .optional()
  .describe("Location (organization) UUID. Defaults to the configured location when omitted.");

// ─────────────────────────────── Locations & identity ───────────────────────────────

server.tool(
  "list_locations",
  "List the co-working locations (organizations) your Spacebring API key can access. Use this to discover the location id (locationRef) the other tools need.",
  {},
  async () => {
    try {
      return ok(await api("GET", "/locations/v1"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "find_membership",
  "Find member memberships in a location — typically to resolve who you are talking to before booking a room or registering a guest. Filter by userEmail (best) or userRef. The result includes the member's credit and day-pass balances. Use the returned membership id as membershipRefOwner (bookings) and the user id as userRefRequester/userRefHost.",
  {
    userEmail: z
      .string()
      .email()
      .optional()
      .describe(
        "Filter by the member's email address — the best way to resolve the current member.",
      ),
    userRef: z.string().optional().describe("Filter by the member's user UUID."),
    status: z
      .enum(["requested"])
      .optional()
      .describe("Pass 'requested' to list only pending membership requests."),
    locationRef: locationRefOpt,
    limit,
    nextPageToken,
  },
  async ({ userEmail, userRef, status, locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/community/memberships/v1", {
          query: {
            locationRef: requireLocation(locationRef),
            userEmail,
            userRef,
            status,
            limit,
            nextPageToken,
          },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_membership",
  "Get a single membership by UUID, including the member's profile, role and credit/day-pass balances.",
  { id: z.string().describe("The membership UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/community/memberships/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Spaces & bookings ───────────────────────────────

server.tool(
  "list_resources",
  "List bookable resources in the location — meeting rooms, hot desks, dedicated desks, offices and parking. NOTE: Spacebring has no direct availability endpoint; to check whether a resource is free for a time window, call list_bookings with that resourceRef and a startDate/endDate range and look for overlaps.",
  {
    types: z
      .string()
      .optional()
      .describe(
        "Comma-separated resource types to filter by: hotDesk, dedicatedDesk, office, parkingLot, room.",
      ),
    locationRef: locationRefOpt,
  },
  async ({ types, locationRef }) => {
    try {
      return ok(
        await api("GET", "/resources/v1", {
          query: { locationRef: requireLocation(locationRef), types },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_resource",
  "Get a single bookable resource by UUID, including capacity, pricing and its booking schedule (opening hours).",
  { id: z.string().describe("The resource UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/resources/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "list_bookings",
  "List resource bookings. Two main uses: (1) check availability — pass resourceRef plus a startDate/endDate window and look for overlapping bookings; (2) list a member's reservations — pass membershipRefOwner (resolve it first with find_membership). Either resourceRef or locationRef is required; locationRef defaults to the configured location.",
  {
    resourceRef: z
      .string()
      .optional()
      .describe(
        "Limit to one resource (room/desk) UUID. Required if you do not pass a locationRef.",
      ),
    membershipRefOwner: z
      .string()
      .optional()
      .describe(
        "Limit to bookings owned by this membership UUID (a specific member's reservations).",
      ),
    startDateFrom: z
      .string()
      .optional()
      .describe(
        "Only bookings starting at/after this ISO-8601 UTC time, e.g. 2026-06-26T00:00:00Z (maps to startDate[gte]).",
      ),
    startDateTo: z
      .string()
      .optional()
      .describe(
        "Only bookings starting at/before this ISO-8601 UTC time (maps to startDate[lte]).",
      ),
    endDateFrom: z
      .string()
      .optional()
      .describe("Only bookings ending at/after this ISO-8601 UTC time (maps to endDate[gte])."),
    endDateTo: z
      .string()
      .optional()
      .describe("Only bookings ending at/before this ISO-8601 UTC time (maps to endDate[lte])."),
    types: z
      .string()
      .optional()
      .describe(
        "Comma-separated resource types: hotDesk, dedicatedDesk, office, parkingLot, room.",
      ),
    order: z
      .string()
      .optional()
      .describe("Sort as field:dir, e.g. startDate:asc (default endDate:asc)."),
    locationRef: locationRefOpt,
    limit,
    nextPageToken,
  },
  async (a) => {
    try {
      const query = {
        resourceRef: a.resourceRef,
        membershipRefOwner: a.membershipRefOwner,
        types: a.types,
        order: a.order,
        limit: a.limit,
        nextPageToken: a.nextPageToken,
        "startDate[gte]": a.startDateFrom,
        "startDate[lte]": a.startDateTo,
        "endDate[gte]": a.endDateFrom,
        "endDate[lte]": a.endDateTo,
      };
      // The endpoint needs resourceRef OR locationRef.
      if (!a.resourceRef) query.locationRef = requireLocation(a.locationRef);
      else if (a.locationRef) query.locationRef = a.locationRef;
      return ok(await api("GET", "/resources/bookings/v1", { query }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "create_booking",
  "Reserve a resource (book a meeting room or desk). Provide the resourceRef and ISO-8601 UTC start/end times. Resolve the member first with find_membership and pass their membership UUID as membershipRefOwner so the booking is attributed to them. Check the slot is free with list_bookings before booking, and confirm the details with the member.",
  {
    resourceRef: z.string().describe("UUID of the resource to book (from list_resources)."),
    startDate: z.string().describe("Booking start, ISO-8601 UTC, e.g. 2026-06-26T14:00:00Z."),
    endDate: z.string().describe("Booking end, ISO-8601 UTC, e.g. 2026-06-26T15:00:00Z."),
    membershipRefOwner: z
      .string()
      .optional()
      .describe(
        "UUID of the membership the booking belongs to (the member). Strongly recommended.",
      ),
    title: z.string().optional().describe("Optional booking title."),
    memo: z.string().optional().describe("Optional note for the booking."),
  },
  async ({ resourceRef, startDate, endDate, membershipRefOwner, title, memo }) => {
    try {
      return ok(
        await api("POST", "/resources/bookings/v1", {
          body: { booking: { resourceRef, startDate, endDate, membershipRefOwner, title, memo } },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_booking",
  "Get a single booking by UUID.",
  { id: z.string().describe("The booking UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/resources/bookings/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "cancel_booking",
  "Cancel (delete) a booking by UUID, which frees the slot. Always confirm with the member before cancelling.",
  { id: z.string().describe("The booking UUID to cancel.") },
  async ({ id }) => {
    try {
      await api("DELETE", `/resources/bookings/v1/${id}`);
      return ok({ deleted: true, id });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Knowledge / FAQ ───────────────────────────────

server.tool(
  "list_guides",
  "List the location's guides — the knowledge base of house info and how-tos (Wi‑Fi, printing, opening hours, house rules, etc.). Use this to answer member FAQs such as 'what's the Wi‑Fi password'. Fetch the full text with get_guide.",
  { locationRef: locationRefOpt, limit, nextPageToken },
  async ({ locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/guides/v1", {
          query: { locationRef: requireLocation(locationRef), limit, nextPageToken },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_guide",
  "Get the full markdown content of a single guide by UUID (e.g. the Wi‑Fi or house-rules article).",
  { id: z.string().describe("The guide UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/guides/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Announcements (feed) ───────────────────────────────

server.tool(
  "list_feed_posts",
  "List community feed posts (announcements and news) for the location. Use for questions like 'any news?' or 'what's happening this week'.",
  { locationRef: locationRefOpt, limit, nextPageToken },
  async ({ locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/feed/posts/v1", {
          query: { locationRef: requireLocation(locationRef), limit, nextPageToken },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_feed_post",
  "Get a single feed post (announcement) by UUID.",
  { id: z.string().describe("The feed post UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/feed/posts/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Events ───────────────────────────────

server.tool(
  "list_events",
  "List community events in the location. Sort with order, e.g. startDate:asc, to surface upcoming events.",
  {
    order: z
      .string()
      .optional()
      .describe("Sort: createDate|startDate|endDate with :asc/:desc, or 'relevance'."),
    locationRef: locationRefOpt,
    limit,
    nextPageToken,
  },
  async ({ order, locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/events/v1", {
          query: { locationRef: requireLocation(locationRef), order, limit, nextPageToken },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_event",
  "Get a single event by UUID, including schedule, venue, pricing and attendance.",
  { id: z.string().describe("The event UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/events/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Benefits / perks ───────────────────────────────

server.tool(
  "list_benefits",
  "List member perks/benefits available in the location (partner discounts and offers).",
  { locationRef: locationRefOpt, limit, nextPageToken },
  async ({ locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/benefits/v1", {
          query: { locationRef: requireLocation(locationRef), limit, nextPageToken },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_benefit",
  "Get a single benefit/perk by UUID, including its full description and how to redeem it.",
  { id: z.string().describe("The benefit UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/benefits/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Plans ───────────────────────────────

server.tool(
  "list_plans",
  "List the membership plans (tiers and pricing) offered at the location. Useful for prospect or member questions like 'what plans do you offer'.",
  { locationRef: locationRefOpt, limit, nextPageToken },
  async ({ locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/plans/v1", {
          query: { locationRef: requireLocation(locationRef), limit, nextPageToken },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Visitors / guests ───────────────────────────────

server.tool(
  "list_visits",
  "List guest visits for the location. Filter by userRefHost to see a specific member's guests (resolve it with find_membership), or by a createDate window.",
  {
    userRefHost: z
      .string()
      .optional()
      .describe("Filter to visits hosted by this user UUID (a specific member's guests)."),
    createDateFrom: z
      .string()
      .optional()
      .describe("Only visits created at/after this ISO-8601 UTC time (createDate[gte])."),
    createDateTo: z
      .string()
      .optional()
      .describe("Only visits created at/before this ISO-8601 UTC time (createDate[lte])."),
    locationRef: locationRefOpt,
    limit,
    nextPageToken,
  },
  async (a) => {
    try {
      return ok(
        await api("GET", "/visitors/visits/v1", {
          query: {
            locationRef: requireLocation(a.locationRef),
            userRefHost: a.userRefHost,
            "createDate[gte]": a.createDateFrom,
            "createDate[lte]": a.createDateTo,
            limit: a.limit,
            nextPageToken: a.nextPageToken,
          },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "create_visit",
  "Register/invite a guest visit. Provide the visit date (ISO-8601 UTC) and the visitor's name + email.",
  {
    date: z.string().describe("Visit date/time, ISO-8601 UTC, e.g. 2026-06-27T09:00:00Z."),
    visitorName: z.string().describe("Visitor's first name."),
    visitorEmail: z.string().email().describe("Visitor's email address."),
    visitorSurname: z.string().optional().describe("Visitor's surname."),
    visitorPhoneNumber: z.string().optional().describe("Visitor's phone number."),
    comment: z.string().optional().describe("Optional note about the visit."),
    locationRef: locationRefOpt,
  },
  async ({
    date,
    visitorName,
    visitorEmail,
    visitorSurname,
    visitorPhoneNumber,
    comment,
    locationRef,
  }) => {
    try {
      return ok(
        await api("POST", "/visitors/visits/v1", {
          body: {
            visit: {
              date,
              locationRef: requireLocation(locationRef),
              comment,
              visitor: {
                name: visitorName,
                email: visitorEmail,
                surname: visitorSurname,
                phoneNumber: visitorPhoneNumber,
              },
            },
          },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_visit",
  "Get a single guest visit by UUID, including the access code and check-in status.",
  { id: z.string().describe("The visit UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/visitors/visits/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "cancel_visit",
  "Cancel (delete) a guest visit by UUID.",
  { id: z.string().describe("The visit UUID to cancel.") },
  async ({ id }) => {
    try {
      await api("DELETE", `/visitors/visits/v1/${id}`);
      return ok({ deleted: true, id });
    } catch (err) {
      return fail(err);
    }
  },
);

// ─────────────────────────────── Support ───────────────────────────────

const TICKET_TYPES = [
  "access",
  "accountAndBilling",
  "bookings",
  "cleaning",
  "discriminationAndHarassment",
  "internet",
  "mailAndPackages",
  "noiseAndAcoustics",
  "offensiveOrObjectionableContent",
  "other",
  "printing",
  "repairAndMaintenance",
  "temperatureAndVentilation",
  "websiteAndApp",
];

server.tool(
  "list_support_tickets",
  "List support tickets for the location (member-reported issues).",
  { locationRef: locationRefOpt, limit, nextPageToken },
  async ({ locationRef, limit, nextPageToken }) => {
    try {
      return ok(
        await api("GET", "/support/tickets/v1", {
          query: { locationRef: requireLocation(locationRef), limit, nextPageToken },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "create_support_ticket",
  "File a support ticket for a member-reported problem (e.g. broken AC, printer down, Wi‑Fi issue). Pick the closest type. Optionally pass userRefRequester (resolve via find_membership) to attribute it to the member.",
  {
    text: z.string().describe("Description of the issue, in the member's words."),
    type: z
      .enum(TICKET_TYPES)
      .describe(
        "Issue category. Use 'repairAndMaintenance' for broken things, 'internet' for Wi‑Fi/connectivity, 'temperatureAndVentilation' for AC/heating, 'cleaning', 'printing', 'access' for doors/access, 'mailAndPackages', 'bookings', or 'other' if unsure.",
      ),
    userRefRequester: z
      .string()
      .optional()
      .describe("UUID of the member reporting the issue (defaults to the API user if omitted)."),
    locationRef: locationRefOpt,
  },
  async ({ text, type, userRefRequester, locationRef }) => {
    try {
      return ok(
        await api("POST", "/support/tickets/v1", {
          body: {
            ticket: { locationRef: requireLocation(locationRef), text, type, userRefRequester },
          },
        }),
      );
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_support_ticket",
  "Get a single support ticket by UUID, including its status and activity history.",
  { id: z.string().describe("The ticket UUID.") },
  async ({ id }) => {
    try {
      return ok(await api("GET", `/support/tickets/v1/${id}`));
    } catch (err) {
      return fail(err);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[spacebring-mcp] server connected over stdio.");
}

main().catch((err) => {
  console.error("[spacebring-mcp] failed to start:", err);
  process.exit(1);
});

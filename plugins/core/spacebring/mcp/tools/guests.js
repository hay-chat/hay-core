/**
 * Guest tools — the "I have a visitor coming" playbook.
 *
 *   spacebring_invite_guest        GET membership (host) → POST visit
 *   spacebring_cancel_guest_visit  GET visits (host's) → DELETE visit
 */

const { z } = require("zod");
const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { sbApi, sbListAll, itemOf } = require("../lib/client");
const {
  handle,
  cleanEmail,
  norm,
  parseDay,
  parseTime,
  zonedToUtc,
  formatLocal,
  localDayKey,
} = require("../lib/format");
const { resolveLocation, findMember } = require("../lib/spacebring");

const DEFAULT_ARRIVAL = "09:00";

const visitHost = (v) => v.userRefHost ?? v.host?.id ?? v.hostRef ?? null;
const visitDate = (v) => v.date ?? v.startDate ?? null;

function shapeVisit(v, location) {
  const visitor = v.visitor ?? {};
  return {
    id: v.id,
    guest: [visitor.name, visitor.surname].filter(Boolean).join(" ") || null,
    guestEmail: visitor.email ?? null,
    when: formatLocal(visitDate(v), location.timeZone),
    accessCode: v.accessCode ?? v.code ?? null,
    status: v.status ?? null,
  };
}

/** "Ana Maria Silva" → { name: "Ana Maria", surname: "Silva" }. */
function splitName(full) {
  const parts = String(full ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return { name: parts[0] ?? "", surname: undefined };
  return { name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
}

function registerGuestTools(server) {
  server.tool(
    "spacebring_invite_guest",
    "Register a guest visit for a member (WRITE). Spacebring emails the guest their invite and " +
      "access details. Pass the host member's email, the guest's full name and email, and the " +
      "day (arrival time optional, default 09:00 local).",
    {
      member_email: z.string().describe("Email of the member hosting the guest."),
      guest_name: z.string().describe('Guest\'s full name, e.g. "Ana Silva".'),
      guest_email: z.string().describe("Guest's email; Spacebring sends the invite there."),
      date: z.string().describe('Day of the visit: YYYY-MM-DD, "today" or "tomorrow".'),
      arrival_time: z
        .string()
        .optional()
        .describe('Expected arrival, local time, e.g. "10:30". Default 09:00.'),
      guest_phone: z.string().optional().describe("Guest's phone number, if given."),
      note: z.string().optional().describe("Note for reception, e.g. the meeting's purpose."),
      location: z.string().optional().describe("Location name or id. Omit for the default."),
    },
    handle(async (args) => {
      const hostEmail = cleanEmail(args.member_email);
      const guestEmail = cleanEmail(args.guest_email, "guest_email");
      const { name, surname } = splitName(args.guest_name);
      if (!name) {
        throw toolError("BAD_INPUT", "Ask the member for their guest's name.", {
          details: { field: "guest_name" },
        });
      }
      const location = await resolveLocation(args.location);
      const day = parseDay(args.date, location.timeZone);
      const arrival = zonedToUtc(
        day,
        parseTime(args.arrival_time || DEFAULT_ARRIVAL, "arrival_time"),
        location.timeZone,
      );
      if (
        arrival < new Date() &&
        localDayKey(arrival, location.timeZone) !== localDayKey(new Date(), location.timeZone)
      ) {
        throw toolError(
          "BAD_INPUT",
          "That day has already passed. Check the date with the member.",
          {
            details: { field: "date" },
          },
        );
      }
      const host = await findMember(hostEmail, location);

      const res = await sbApi("POST", "/visitors/visits/v1", {
        body: {
          visit: {
            date: arrival.toISOString(),
            locationRef: location.id,
            userRefHost: host.userId ?? undefined,
            comment: args.note || undefined,
            visitor: {
              name,
              surname,
              email: guestEmail,
              phoneNumber: args.guest_phone || undefined,
            },
          },
        },
      });
      const visit = shapeVisit(
        {
          date: arrival.toISOString(),
          visitor: { name, surname, email: guestEmail },
          ...(itemOf(res, "visit") ?? {}),
        },
        location,
      );
      return {
        status: "INVITED",
        visit,
        summary:
          `Registered ${visit.guest} as ${host.name || host.email}'s guest, ${visit.when} ` +
          `(${location.timeZone}). Spacebring emails the invite to ${guestEmail}.` +
          (args.arrival_time ? "" : " Arrival time defaulted to 09:00."),
      };
    }),
  );

  server.tool(
    "spacebring_cancel_guest_visit",
    "Cancel a guest visit the member registered (WRITE). Identify it by visit_id, or by the " +
      "guest's name and/or the day; if several match, the tool lists them so you can ask.",
    {
      member_email: z.string().describe("Email of the member who invited the guest."),
      visit_id: z.string().optional().describe("Visit id (from spacebring_get_member)."),
      guest_name: z.string().optional().describe("Guest's name, to pick the visit without an id."),
      date: z.string().optional().describe("Day of the visit, to pick it without an id."),
      location: z.string().optional().describe("Location name or id. Omit for the default."),
    },
    handle(async (args) => {
      const email = cleanEmail(args.member_email);
      const location = await resolveLocation(args.location);
      const host = await findMember(email, location);
      const { items } = await sbListAll("/visitors/visits/v1", "visits", {
        locationRef: location.id,
        userRefHost: host.userId ?? undefined,
      });
      const now = new Date();
      const mine = items.filter((v) => visitHost(v) === host.userId);

      let candidates;
      if (args.visit_id) {
        candidates = items.filter((v) => v.id === args.visit_id);
        if (candidates.length && !mine.includes(candidates[0])) {
          throw toolError(
            "PRECONDITION",
            `Visit ${args.visit_id} was not registered by ${email}. Only the host can cancel it.`,
          );
        }
      } else {
        candidates = mine.filter((v) => new Date(visitDate(v)) >= now);
        if (args.guest_name) {
          const q = norm(args.guest_name);
          candidates = candidates.filter((v) =>
            norm(`${v.visitor?.name ?? ""} ${v.visitor?.surname ?? ""}`).includes(q),
          );
        }
        if (args.date) {
          const d = parseDay(args.date, location.timeZone);
          const wanted = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
          candidates = candidates.filter(
            (v) => localDayKey(visitDate(v), location.timeZone) === wanted,
          );
        }
      }

      if (!candidates.length) {
        throw toolError("NOT_FOUND", `${email} has no upcoming guest visit matching that.`);
      }
      if (candidates.length > 1) {
        throw toolError(
          "BAD_INPUT",
          `${candidates.length} guest visits match. Ask the member which one, then pass its visit_id.`,
          { details: { visits: candidates.slice(0, 10).map((v) => shapeVisit(v, location)) } },
        );
      }
      const visit = candidates[0];
      await sbApi("DELETE", `/visitors/visits/v1/${encodeURIComponent(visit.id)}`);
      const shaped = shapeVisit(visit, location);
      return {
        status: "CANCELLED",
        visit: shaped,
        summary: `Cancelled ${shaped.guest ?? "the guest"}'s visit on ${shaped.when}.`,
      };
    }),
  );
}

module.exports = { registerGuestTools, shapeVisit, visitHost, visitDate, splitName };

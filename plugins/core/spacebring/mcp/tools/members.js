/**
 * Member tools — "who am I talking to, and what have they got coming up".
 *
 *   spacebring_get_member  GET membership (by email) + bookings + visits + tickets, in parallel
 */

const { z } = require("zod");
const { sbListAll } = require("../lib/client");
const { handle, cleanEmail, formatLocal } = require("../lib/format");
const {
  resolveLocation,
  findMember,
  listSpaces,
  upcomingBookings,
  shapeBooking,
} = require("../lib/spacebring");
const { shapeVisit, visitHost, visitDate } = require("./guests");
const { shapeTicket, ticketRequester, OPEN_TICKET } = require("./support");

function registerMemberTools(server) {
  server.tool(
    "spacebring_get_member",
    "Look up a member by email (READ): their name, plan, membership status, credit and day-pass " +
      "balances, upcoming bookings, upcoming guest visits and open support tickets. One call " +
      "answers 'what have I booked?', 'how many credits do I have?' and 'is my ticket fixed?'. " +
      "The booking and visit ids it returns are what the cancel/move tools take.",
    {
      member_email: z
        .string()
        .describe("Email the member uses to sign in to Spacebring, e.g. ana@example.com."),
      location: z
        .string()
        .optional()
        .describe("Location name or id. Omit to use the space's default location."),
    },
    handle(async (args) => {
      const email = cleanEmail(args.member_email);
      const location = await resolveLocation(args.location);
      const member = await findMember(email, location);
      const now = new Date();

      const [bookings, spaces, visits, tickets] = await Promise.all([
        upcomingBookings(member, location, now),
        listSpaces(location),
        member.userId
          ? sbListAll("/visitors/visits/v1", "visits", {
              locationRef: location.id,
              userRefHost: member.userId,
            }).then(({ items }) => items)
          : [],
        member.userId
          ? sbListAll(
              "/support/tickets/v1",
              "tickets",
              { locationRef: location.id },
              { maxPages: 2 },
            ).then(({ items }) => items)
          : [],
      ]);
      const spacesById = new Map(spaces.map((s) => [s.id, s]));
      const upcomingVisits = visits
        .filter((v) => visitHost(v) === member.userId && new Date(visitDate(v)) >= now)
        .sort((a, b) => new Date(visitDate(a)) - new Date(visitDate(b)));
      const openTickets = tickets.filter(
        (t) => ticketRequester(t) === member.userId && OPEN_TICKET(t),
      );

      return {
        member,
        location: location.name,
        timeZone: location.timeZone,
        upcomingBookings: bookings.slice(0, 15).map((b) => shapeBooking(b, location, spacesById)),
        upcomingGuestVisits: upcomingVisits.slice(0, 15).map((v) => shapeVisit(v, location)),
        openTickets: openTickets.slice(0, 10).map((t) => shapeTicket(t, location)),
        summary:
          `${member.name || member.email}: ${bookings.length} upcoming booking(s), ` +
          `${upcomingVisits.length} upcoming guest visit(s), ${openTickets.length} open ticket(s)` +
          (member.credits !== null ? `, credits: ${JSON.stringify(member.credits)}` : "") +
          `. Checked ${formatLocal(now, location.timeZone)} (${location.timeZone}).`,
      };
    }),
  );
}

module.exports = { registerMemberTools };

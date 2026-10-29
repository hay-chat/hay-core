/**
 * Booking tools — the "book / move / cancel a room" playbooks.
 *
 * Spacebring has no availability endpoint, so availability is computed here:
 * list the spaces, read the bookings that overlap the requested window, and
 * subtract. Writes re-check the slot and the member's ownership first.
 *
 *   spacebring_find_available_spaces  GET resources + GET bookings (overlap)
 *   spacebring_book_space             GET membership, resources, bookings → POST booking
 *   spacebring_move_booking           GET booking → GET bookings → POST new → DELETE old
 *   spacebring_cancel_booking         GET booking(s) → DELETE booking
 */

const { z } = require("zod");
const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { sbApi, itemOf } = require("../lib/client");
const {
  handle,
  cleanEmail,
  resolveWindow,
  formatRange,
  formatClock,
  parseDay,
} = require("../lib/format");
const {
  resolveLocation,
  findMember,
  parseSpaceType,
  listSpaces,
  resolveSpace,
  shapeBooking,
  bookingsOverlapping,
  pickMemberBooking,
  bookingStart,
  bookingEnd,
  bookingSpaceId,
} = require("../lib/spacebring");

const LOCATION = z
  .string()
  .optional()
  .describe("Location name or id. Omit to use the space's default location.");
const MEMBER_EMAIL = z
  .string()
  .describe("Email the member uses to sign in to Spacebring, e.g. ana@example.com.");
const DATE = z
  .string()
  .describe('Day of the booking: YYYY-MM-DD, "today" or "tomorrow". Local to the space.');
const START = z
  .string()
  .describe('Start time in the space\'s local time, e.g. "14:00", "2pm", "14h30".');
const END = z
  .string()
  .optional()
  .describe("End time (local). Give this or duration_minutes; default is 60 minutes.");
const DURATION = z
  .number()
  .optional()
  .describe("Length in minutes, used when end_time is not given (default 60).");

function assertFuture(start, now = new Date()) {
  if (start < now) {
    throw toolError(
      "BAD_INPUT",
      "That time has already passed. Check the date and time with the member.",
      { details: { field: "start_time" } },
    );
  }
}

/** Busy intervals per space id for a list of overlapping bookings. */
function busyBySpace(bookings, tz) {
  const busy = new Map();
  for (const b of bookings) {
    const id = bookingSpaceId(b);
    const list = busy.get(id) ?? [];
    list.push(`${formatClock(bookingStart(b), tz)}–${formatClock(bookingEnd(b), tz)}`);
    busy.set(id, list);
  }
  return busy;
}

/** Spaces of `type` (with room for `attendees`) that are free for the whole window. */
async function freeSpaces(location, start, end, { type, attendees, excludeBookingId } = {}) {
  const [spaces, bookings] = await Promise.all([
    listSpaces(location, type),
    bookingsOverlapping(location, start, end),
  ]);
  const relevant = bookings.filter((b) => b.id !== excludeBookingId);
  const busy = busyBySpace(relevant, location.timeZone);
  const fits = spaces.filter((s) => !attendees || s.capacity === null || s.capacity >= attendees);
  return {
    spaces: fits,
    free: fits.filter((s) => !busy.has(s.id)),
    busy,
  };
}

function registerBookingTools(server) {
  server.tool(
    "spacebring_find_available_spaces",
    "Find which rooms, desks or other spaces are free for a time slot (READ). Use before " +
      "booking, or when a member asks 'is the X room free at 3pm?'. Pass a space name to check " +
      "one space; it also returns the other free spaces of the same kind as alternatives.",
    {
      date: DATE,
      start_time: START,
      end_time: END,
      duration_minutes: DURATION,
      attendees: z
        .number()
        .optional()
        .describe("How many people. Spaces with a smaller capacity are left out."),
      space_type: z
        .string()
        .optional()
        .describe(
          'Kind of space in the member\'s words: "meeting room", "desk", "parking", "office".',
        ),
      space: z.string().optional().describe("A space name (or id) to check specifically."),
      location: LOCATION,
    },
    handle(async (args) => {
      const location = await resolveLocation(args.location);
      const { start, end } = resolveWindow(args, location.timeZone);
      assertFuture(start);

      const target = args.space ? await resolveSpace(location, args.space) : null;
      const type = target?.type ?? parseSpaceType(args.space_type);
      const { spaces, free, busy } = await freeSpaces(location, start, end, {
        type,
        attendees: args.attendees,
      });
      const when = formatRange(start, end, location.timeZone);
      const alternatives = free.filter((s) => s.id !== target?.id).slice(0, 15);

      let summary;
      if (target) {
        const targetBusy = busy.get(target.id);
        summary = targetBusy
          ? `${target.name} is already booked ${targetBusy.join(", ")}, so it is not free ${when}. ` +
            (alternatives.length
              ? `Free instead: ${alternatives.map((s) => s.name).join(", ")}.`
              : "No other space of that kind is free then.")
          : `${target.name} is free ${when}.`;
      } else {
        summary = free.length
          ? `${free.length} of ${spaces.length} spaces are free ${when}.`
          : `Nothing is free ${when}. Suggest another time.`;
      }

      return {
        location: location.name,
        timeZone: location.timeZone,
        when,
        start: start.toISOString(),
        end: end.toISOString(),
        ...(target ? { space: { ...target, free: !busy.has(target.id) } } : {}),
        available: target ? alternatives : free.slice(0, 15),
        unavailable: spaces
          .filter((s) => busy.has(s.id) && s.id !== target?.id)
          .map((s) => ({ name: s.name, booked: busy.get(s.id) })),
        summary,
        next: "Confirm the space and time with the member, then call spacebring_book_space.",
      };
    }),
  );

  server.tool(
    "spacebring_book_space",
    "Book a room, desk or other space for a member (WRITE). Pass the member's email, the space " +
      "name and the time as they said it; the tool finds the member and the space, checks the " +
      "slot is free and books it. Confirm the details with the member first. If the slot is " +
      "taken it returns the conflicting times and free alternatives instead of booking.",
    {
      member_email: MEMBER_EMAIL,
      space: z.string().describe('Space name (or id), e.g. "Orange Room". Partial names work.'),
      date: DATE,
      start_time: START,
      end_time: END,
      duration_minutes: DURATION,
      title: z.string().optional().describe("Optional booking title, e.g. the meeting's name."),
      note: z.string().optional().describe("Optional note for the space team."),
      location: LOCATION,
    },
    handle(async (args) => {
      const email = cleanEmail(args.member_email);
      const location = await resolveLocation(args.location);
      const { start, end } = resolveWindow(args, location.timeZone);
      assertFuture(start);
      const [member, space] = await Promise.all([
        findMember(email, location),
        resolveSpace(location, args.space),
      ]);

      const conflicts = await bookingsOverlapping(location, start, end, { spaceId: space.id });
      const when = formatRange(start, end, location.timeZone);
      if (conflicts.length) {
        const { free } = await freeSpaces(location, start, end, { type: space.type });
        const taken = busyBySpace(conflicts, location.timeZone).get(space.id) ?? [];
        const alternatives = free.filter((s) => s.id !== space.id).slice(0, 10);
        throw toolError(
          "PRECONDITION",
          `${space.name} is already booked ${taken.join(", ")}, so it cannot be booked ${when}. ` +
            (alternatives.length
              ? `Free at that time: ${alternatives.map((s) => s.name).join(", ")}. Offer one of those or another time.`
              : "No other space of that kind is free then; offer another time."),
          { details: { space: space.name, booked: taken, alternatives } },
        );
      }

      const res = await sbApi("POST", "/resources/bookings/v1", {
        body: {
          booking: {
            resourceRef: space.id,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            membershipRefOwner: member.membershipId,
            title: args.title || undefined,
            memo: args.note || undefined,
          },
        },
      });
      const booking = itemOf(res, "booking") ?? {};
      return {
        status: "BOOKED",
        booking: shapeBooking(
          {
            resourceRef: space.id,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            ...booking,
          },
          location,
          new Map([[space.id, space]]),
        ),
        member: { name: member.name, email: member.email },
        summary: `Booked ${space.name} for ${member.name || member.email}, ${when} (${location.timeZone}).`,
        next: "Spacebring applies its own credit/pricing rules; spacebring_get_member shows the member's balance.",
      };
    }),
  );

  server.tool(
    "spacebring_move_booking",
    "Move a member's booking to another time and/or space (WRITE). Books the new slot first and " +
      "only then cancels the old one, so the member never loses their room. Omit booking_id when " +
      "the member has a single upcoming booking (or narrow with current_date). Fields you leave " +
      "out keep their current value (same space, same day, same length).",
    {
      member_email: MEMBER_EMAIL,
      booking_id: z.string().optional().describe("Booking to move (from spacebring_get_member)."),
      current_date: z
        .string()
        .optional()
        .describe(
          "Day of the booking to move, to pick it without an id (YYYY-MM-DD/today/tomorrow).",
        ),
      new_date: z.string().optional().describe("New day. Default: the same day."),
      new_start_time: START,
      new_end_time: END,
      duration_minutes: z
        .number()
        .optional()
        .describe("New length in minutes. Default: unchanged."),
      new_space: z.string().optional().describe("New space name. Default: the same space."),
      location: LOCATION,
    },
    handle(async (args) => {
      const email = cleanEmail(args.member_email);
      const location = await resolveLocation(args.location);
      const member = await findMember(email, location);
      const { booking, spacesById } = await pickMemberBooking(member, location, {
        bookingId: args.booking_id,
        date: args.current_date,
      });
      const oldStart = new Date(bookingStart(booking));
      const oldEnd = new Date(bookingEnd(booking));
      if (oldStart < new Date()) {
        throw toolError(
          "PRECONDITION",
          "This booking has already started, so it cannot be moved. Offer a new booking instead.",
        );
      }

      const space = args.new_space
        ? await resolveSpace(location, args.new_space)
        : (spacesById.get(bookingSpaceId(booking)) ?? {
            id: bookingSpaceId(booking),
            name: bookingSpaceId(booking),
          });
      const oldDay = parseDay(oldStart.toISOString(), location.timeZone);
      const { start, end } = resolveWindow(
        {
          date: args.new_date ?? `${oldDay.year}-${oldDay.month}-${oldDay.day}`,
          start_time: args.new_start_time,
          end_time: args.new_end_time,
          duration_minutes: args.duration_minutes ?? Math.round((oldEnd - oldStart) / 60000),
        },
        location.timeZone,
      );
      assertFuture(start);
      if (space.id === bookingSpaceId(booking) && +start === +oldStart && +end === +oldEnd) {
        throw toolError("BAD_INPUT", "The new time and space are the same as the current booking.");
      }

      const conflicts = (
        await bookingsOverlapping(location, start, end, { spaceId: space.id })
      ).filter((b) => b.id !== booking.id);
      const oldShaped = shapeBooking(booking, location, spacesById);
      if (conflicts.length) {
        const taken = busyBySpace(conflicts, location.timeZone).get(space.id) ?? [];
        throw toolError(
          "PRECONDITION",
          `${space.name} is already booked ${taken.join(", ")}. The current booking (${oldShaped.when}) ` +
            "is unchanged. Use spacebring_find_available_spaces to find a free slot.",
          { details: { space: space.name, booked: taken } },
        );
      }

      let created;
      try {
        created = itemOf(
          await sbApi("POST", "/resources/bookings/v1", {
            body: {
              booking: {
                resourceRef: space.id,
                startDate: start.toISOString(),
                endDate: end.toISOString(),
                membershipRefOwner: member.membershipId,
                title: booking.title || undefined,
                memo: booking.memo || undefined,
              },
            },
          }),
          "booking",
        );
      } catch (err) {
        err.message = `${err.message} The current booking (${oldShaped.when}) is unchanged.`;
        throw err;
      }
      const newShaped = shapeBooking(
        {
          resourceRef: space.id,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          ...created,
        },
        location,
        new Map([...spacesById, [space.id, space]]),
      );

      try {
        await sbApi("DELETE", `/resources/bookings/v1/${encodeURIComponent(booking.id)}`);
      } catch (err) {
        return {
          status: "NEW_BOOKED_OLD_KEPT",
          booking: newShaped,
          previous: oldShaped,
          summary:
            `Booked ${newShaped.space}, ${newShaped.when}, but the old booking (${oldShaped.when}) ` +
            `could not be cancelled: ${err.message} The member now holds both.`,
          next: `Call spacebring_cancel_booking with booking_id ${booking.id} to free the old slot, or tell the member.`,
        };
      }

      return {
        status: "MOVED",
        booking: newShaped,
        previous: oldShaped,
        summary: `Moved the booking from ${oldShaped.space}, ${oldShaped.when} to ${newShaped.space}, ${newShaped.when} (${location.timeZone}).`,
      };
    }),
  );

  server.tool(
    "spacebring_cancel_booking",
    "Cancel one of the member's bookings (WRITE). Only the member's own bookings can be " +
      "cancelled. Omit booking_id when they have a single upcoming booking, or narrow with " +
      "date/space; if several match, the tool lists them so you can ask which. Confirm first.",
    {
      member_email: MEMBER_EMAIL,
      booking_id: z.string().optional().describe("Booking to cancel (from spacebring_get_member)."),
      date: z.string().optional().describe("Day of the booking, to pick it without an id."),
      space: z.string().optional().describe("Space name of the booking, to pick it without an id."),
      location: LOCATION,
    },
    handle(async (args) => {
      const email = cleanEmail(args.member_email);
      const location = await resolveLocation(args.location);
      const member = await findMember(email, location);
      const { booking, spacesById } = await pickMemberBooking(member, location, {
        bookingId: args.booking_id,
        date: args.date,
        space: args.space,
      });
      const shaped = shapeBooking(booking, location, spacesById);
      if (new Date(bookingEnd(booking)) < new Date()) {
        throw toolError(
          "PRECONDITION",
          `The booking ${shaped.space}, ${shaped.when} already took place.`,
        );
      }
      await sbApi("DELETE", `/resources/bookings/v1/${encodeURIComponent(booking.id)}`);
      return {
        status: "CANCELLED",
        booking: shaped,
        summary: `Cancelled ${shaped.space}, ${shaped.when} (${location.timeZone}).`,
      };
    }),
  );
}

module.exports = { registerBookingTools };

/**
 * Spacebring domain helpers shared by the tools: resolve a location, a member
 * (by email), a space (by name) and a member's booking, and shape Spacebring
 * objects into the few fields a chat reply needs.
 *
 * Field access is deliberately tolerant (`b.resourceRef ?? b.resource?.id`):
 * Spacebring's public reference names the refs, but nested shapes vary by
 * endpoint, and a missing field must degrade to `null`, not crash a tool.
 */

const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { sameEmail } = require("@hay/plugin-sdk/identity");
const { sbApi, sbListAll, listOf, itemOf } = require("./client");
const {
  norm,
  matchByName,
  validTimeZone,
  formatRange,
  overlaps,
  parseDay,
  localDayKey,
} = require("./format");

// ─────────────────────────────── locations ───────────────────────────────

let locationsCache = null;

async function listLocations() {
  if (!locationsCache) {
    const res = await sbApi("GET", "/locations/v1");
    locationsCache = listOf(res, "locations");
  }
  return locationsCache;
}

function shapeLocation(raw) {
  return {
    id: raw.id,
    name: raw.name ?? raw.title ?? raw.id,
    timeZone:
      validTimeZone(raw.timeZone ?? raw.timezone ?? raw.address?.timeZone) ??
      validTimeZone(process.env.SPACEBRING_TIME_ZONE) ??
      "UTC",
  };
}

/**
 * The location a tool acts on: the one the member named, else the configured
 * default, else the only location the API key sees.
 */
async function resolveLocation(input) {
  const locations = await listLocations();
  const wanted = (input || process.env.SPACEBRING_LOCATION_REF || "").trim();
  if (wanted) {
    const { match, candidates } = matchByName(locations, wanted, (l) => l.name ?? l.title);
    if (match) return shapeLocation(match);
    if (!input) {
      // A configured id the list does not show (e.g. a key scoped differently): trust it.
      return shapeLocation({ id: wanted });
    }
    const names = (candidates.length ? candidates : locations).map((l) => l.name ?? l.id);
    throw toolError(
      candidates.length ? "BAD_INPUT" : "NOT_FOUND",
      candidates.length
        ? `"${input}" matches several locations: ${names.join(", ")}. Ask the member which one.`
        : `No location called "${input}". The locations are: ${names.join(", ")}.`,
      { details: { field: "location", locations: names } },
    );
  }
  if (locations.length === 1) return shapeLocation(locations[0]);
  if (locations.length === 0) {
    throw toolError("INTERNAL", "The Spacebring API key cannot see any location.");
  }
  const names = locations.map((l) => l.name ?? l.id);
  throw toolError(
    "BAD_INPUT",
    `This Spacebring network has several locations (${names.join(", ")}) and no default is ` +
      "configured. Ask the member which location they mean and pass it as `location`.",
    { details: { field: "location", locations: names } },
  );
}

// ─────────────────────────────── members ───────────────────────────────

const memberEmail = (m) => m.user?.email ?? m.userEmail ?? m.email ?? null;

function shapeMember(m) {
  const user = m.user ?? {};
  const name = [user.name ?? user.firstName ?? m.name, user.surname ?? user.lastName]
    .filter(Boolean)
    .join(" ");
  return {
    membershipId: m.id,
    userId: m.userRef ?? user.id ?? user.ref ?? null,
    name: name || null,
    email: memberEmail(m),
    role: m.role ?? null,
    status: m.status ?? null,
    plan: m.plan?.name ?? m.planName ?? null,
    credits: m.credits ?? m.creditBalance ?? null,
    dayPasses: m.dayPasses ?? m.dayPassBalance ?? null,
  };
}

/** The member with this email at the location, or NOT_FOUND telling the agent what to ask. */
async function findMember(email, location) {
  const res = await sbApi("GET", "/community/memberships/v1", {
    query: { locationRef: location.id, userEmail: email },
  });
  const found = listOf(res, "memberships").filter(
    (m) => !memberEmail(m) || sameEmail(memberEmail(m), email),
  );
  if (!found.length) {
    throw toolError(
      "NOT_FOUND",
      `No member with the email ${email} at ${location.name}. Ask the member to confirm the ` +
        "email they use to sign in to Spacebring (it can differ from the one they are chatting " +
        "with). If they are not a member yet, offer the plans (spacebring_list_plans).",
      { details: { field: "member_email" } },
    );
  }
  return shapeMember(found[0]);
}

// ─────────────────────────────── spaces ───────────────────────────────

/** Spacebring resource types and what members call them. */
const SPACE_TYPES = {
  room: ["room", "meeting room", "meeting", "conference", "boardroom", "sala", "sala de reuniao"],
  hotDesk: ["hot desk", "hotdesk", "desk", "flex desk", "coworking", "mesa", "posto"],
  dedicatedDesk: ["dedicated desk", "fixed desk", "dedicated", "mesa fixa"],
  office: ["office", "private office", "escritorio"],
  parkingLot: ["parking", "parking lot", "parking space", "car", "estacionamento", "vaga"],
};

/** A Spacebring type from free text; null when the text names no type (search all). */
function parseSpaceType(input) {
  const q = norm(input);
  if (!q) return null;
  for (const [type, words] of Object.entries(SPACE_TYPES)) {
    if (norm(type) === q || words.includes(q)) return type;
  }
  for (const [type, words] of Object.entries(SPACE_TYPES)) {
    if (words.some((w) => q.includes(w))) return type;
  }
  return null;
}

function shapeSpace(r) {
  return {
    id: r.id,
    name: r.name ?? r.title ?? r.id,
    type: r.type ?? null,
    capacity: r.capacity ?? r.seats ?? r.maxCapacity ?? null,
  };
}

async function listSpaces(location, type) {
  const { items } = await sbListAll("/resources/v1", "resources", {
    locationRef: location.id,
    types: type || undefined,
  });
  return items.map(shapeSpace);
}

/** One space by name or id, or a coded error listing what exists / what matched. */
async function resolveSpace(location, query) {
  const spaces = await listSpaces(location);
  const { match, candidates } = matchByName(spaces, query, (s) => s.name);
  if (match) return match;
  if (candidates.length) {
    throw toolError(
      "BAD_INPUT",
      `"${query}" matches several spaces: ${candidates.map((s) => s.name).join(", ")}. Ask the member which one.`,
      { details: { field: "space", matches: candidates } },
    );
  }
  throw toolError(
    "NOT_FOUND",
    `No space called "${query}" at ${location.name}. Spaces: ${spaces.map((s) => s.name).join(", ")}.`,
    { details: { field: "space", spaces: spaces.map((s) => s.name) } },
  );
}

// ─────────────────────────────── bookings ───────────────────────────────

const bookingStart = (b) => b.startDate ?? b.start ?? null;
const bookingEnd = (b) => b.endDate ?? b.end ?? null;
const bookingSpaceId = (b) => b.resourceRef ?? b.resource?.id ?? null;
const bookingOwner = (b) =>
  b.membershipRefOwner ?? b.membership?.id ?? b.owner?.membershipRef ?? null;

function shapeBooking(b, location, spacesById = new Map()) {
  const spaceId = bookingSpaceId(b);
  return {
    id: b.id,
    space: spacesById.get(spaceId)?.name ?? b.resource?.name ?? spaceId,
    spaceId,
    start: bookingStart(b),
    end: bookingEnd(b),
    when: formatRange(bookingStart(b), bookingEnd(b), location.timeZone),
    title: b.title ?? null,
  };
}

/** Bookings that overlap [start, end), for one space or the whole location. */
async function bookingsOverlapping(location, start, end, { spaceId } = {}) {
  const { items } = await sbListAll("/resources/bookings/v1", "bookings", {
    ...(spaceId ? { resourceRef: spaceId } : { locationRef: location.id }),
    "startDate[lte]": end.toISOString(),
    "endDate[gte]": start.toISOString(),
  });
  return items.filter((b) => overlaps(bookingStart(b), bookingEnd(b), start, end));
}

/** A member's bookings that have not ended yet, soonest first. */
async function upcomingBookings(member, location, now = new Date()) {
  const { items } = await sbListAll("/resources/bookings/v1", "bookings", {
    locationRef: location.id,
    membershipRefOwner: member.membershipId,
    "endDate[gte]": now.toISOString(),
    order: "startDate:asc",
  });
  return items
    .filter((b) => bookingOwner(b) === member.membershipId)
    .filter((b) => new Date(bookingEnd(b)) > now)
    .sort((a, b) => new Date(bookingStart(a)) - new Date(bookingStart(b)));
}

/**
 * The member's booking a cancel/move acts on: the one they named by id
 * (refused if it is not theirs), else the only upcoming one that fits the
 * optional date/space hints, else a list to ask from.
 */
async function pickMemberBooking(member, location, { bookingId, date, space }, now = new Date()) {
  const spaces = await listSpaces(location);
  const spacesById = new Map(spaces.map((s) => [s.id, s]));

  if (bookingId) {
    const booking = itemOf(
      await sbApi("GET", `/resources/bookings/v1/${encodeURIComponent(bookingId)}`),
      "booking",
    );
    if (bookingOwner(booking) !== member.membershipId) {
      throw toolError(
        "PRECONDITION",
        `Booking ${bookingId} is not one of ${member.email}'s bookings. Only the member who made a ` +
          "booking can change it. Call spacebring_get_member to see their bookings.",
        { details: { field: "booking_id" } },
      );
    }
    return { booking, spacesById };
  }

  let candidates = await upcomingBookings(member, location, now);
  if (date) {
    const d = parseDay(date, location.timeZone, now);
    const wanted = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    candidates = candidates.filter(
      (b) => localDayKey(bookingStart(b), location.timeZone) === wanted,
    );
  }
  if (space) {
    const q = norm(space);
    candidates = candidates.filter((b) =>
      norm(spacesById.get(bookingSpaceId(b))?.name ?? "").includes(q),
    );
  }
  if (candidates.length === 1) return { booking: candidates[0], spacesById };
  if (!candidates.length) {
    throw toolError(
      "NOT_FOUND",
      `${member.email} has no upcoming booking${date || space ? " matching that" : ""}.`,
      { details: { field: "booking_id" } },
    );
  }
  const list = candidates.slice(0, 10).map((b) => shapeBooking(b, location, spacesById));
  throw toolError(
    "BAD_INPUT",
    `${member.email} has ${candidates.length} upcoming bookings. Ask which one, then pass its booking_id.`,
    { details: { field: "booking_id", bookings: list } },
  );
}

function resetCaches() {
  locationsCache = null;
}

module.exports = {
  resolveLocation,
  findMember,
  shapeMember,
  parseSpaceType,
  listSpaces,
  resolveSpace,
  shapeBooking,
  bookingsOverlapping,
  upcomingBookings,
  pickMemberBooking,
  bookingStart,
  bookingEnd,
  bookingSpaceId,
  bookingOwner,
  resetCaches,
};

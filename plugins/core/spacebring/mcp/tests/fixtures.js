/**
 * Shared Spacebring fixtures and a route table for mockFetch.
 * Times are in June 2027, when Europe/Lisbon is UTC+1.
 */

const LOCATION = { id: "loc-1", name: "Lisbon Hub", timeZone: "Europe/Lisbon" };

const MEMBER = {
  id: "mem-1",
  userRef: "user-1",
  status: "active",
  credits: 10,
  user: { id: "user-1", name: "Ana", surname: "Silva", email: "ana@example.com" },
};

const SPACES = [
  { id: "res-orange", name: "Orange Room", type: "room", capacity: 6 },
  { id: "res-blue", name: "Blue Room", type: "room", capacity: 4 },
  { id: "res-desk", name: "Hot Desk 1", type: "hotDesk", capacity: 1 },
];

/**
 * Routes for a Spacebring account holding `bookings` (mutated by POST/DELETE so
 * a test can assert the end state). Extra routes go first and win.
 */
function spacebringRoutes({ bookings = [], extra = [], members = [MEMBER] } = {}) {
  let nextId = 1;
  return [
    ...extra,
    { path: "/locations/v1", reply: () => ({ locations: [LOCATION] }) },
    {
      path: "/community/memberships/v1",
      reply: ({ query }) => ({
        memberships: members.filter((m) => m.user.email === query.get("userEmail")),
      }),
    },
    {
      path: "/resources/v1",
      reply: ({ query }) => ({
        resources: SPACES.filter((s) => !query.get("types") || s.type === query.get("types")),
      }),
    },
    {
      path: "/resources/bookings/v1",
      reply: ({ query }) => ({
        bookings: bookings.filter(
          (b) =>
            (!query.get("resourceRef") || b.resourceRef === query.get("resourceRef")) &&
            (!query.get("membershipRefOwner") ||
              b.membershipRefOwner === query.get("membershipRefOwner")) &&
            (!query.get("startDate[lte]") || b.startDate <= query.get("startDate[lte]")) &&
            (!query.get("endDate[gte]") || b.endDate >= query.get("endDate[gte]")),
        ),
      }),
    },
    {
      method: "GET",
      path: /^\/resources\/bookings\/v1\/[^/]+$/,
      reply: ({ path }) => {
        const b = bookings.find((x) => path.endsWith(`/${x.id}`));
        return b ? { booking: b } : { status: 404, body: { message: "Booking not found" } };
      },
    },
    {
      method: "POST",
      path: "/resources/bookings/v1",
      reply: ({ body }) => {
        const booking = { id: `new-${nextId++}`, ...body.booking };
        bookings.push(booking);
        return { booking };
      },
    },
    {
      method: "DELETE",
      path: /^\/resources\/bookings\/v1\/[^/]+$/,
      reply: ({ path }) => {
        const i = bookings.findIndex((x) => path.endsWith(`/${x.id}`));
        if (i >= 0) bookings.splice(i, 1);
        return { status: 204, body: null };
      },
    },
  ];
}

module.exports = { LOCATION, MEMBER, SPACES, spacebringRoutes };

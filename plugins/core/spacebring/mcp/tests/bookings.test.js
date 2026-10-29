import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { spacebringRoutes } = require("./fixtures");
const { registerBookingTools } = require("../tools/bookings");
const { resetCaches } = require("../lib/spacebring");

process.env.SPACEBRING_API_KEY_ID = "key-id";
process.env.SPACEBRING_API_KEY_SECRET = "key-secret";

// 14:00–15:00 Lisbon on 15 June 2027 (UTC+1).
const SLOT = { date: "2027-06-15", start_time: "14:00", duration_minutes: 60 };
const ORANGE_BUSY = {
  id: "bk-other",
  resourceRef: "res-orange",
  membershipRefOwner: "mem-2",
  startDate: "2027-06-15T13:30:00.000Z",
  endDate: "2027-06-15T14:30:00.000Z",
};
const ANA_BOOKING = {
  id: "bk-ana",
  resourceRef: "res-blue",
  membershipRefOwner: "mem-1",
  title: "Standup",
  startDate: "2027-06-16T09:00:00.000Z",
  endDate: "2027-06-16T10:00:00.000Z",
};

let server;
beforeEach(() => {
  resetCaches();
  delete process.env.SPACEBRING_LOCATION_REF;
  server = createFakeServer();
  registerBookingTools(server);
});

const writes = (calls) =>
  calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);

describe("spacebring_find_available_spaces", () => {
  it("subtracts overlapping bookings and offers alternatives for a busy room", async () => {
    mockFetch(spacebringRoutes({ bookings: [ORANGE_BUSY] }));
    const res = await server.call("spacebring_find_available_spaces", { ...SLOT, space: "orange" });
    expect(res.isError).toBe(false);
    expect(res.data.space).toMatchObject({ name: "Orange Room", free: false });
    expect(res.data.available.map((s) => s.name)).toEqual(["Blue Room"]);
    expect(res.data.summary).toContain("Orange Room is already booked 14:30–15:30");
    expect(res.data.when).toBe("Tue, 15 Jun 2027, 14:00–15:00");
  });

  it("filters by attendees and by the type in the member's words", async () => {
    mockFetch(spacebringRoutes());
    const res = await server.call("spacebring_find_available_spaces", {
      ...SLOT,
      space_type: "meeting room",
      attendees: 5,
    });
    expect(res.data.available.map((s) => s.name)).toEqual(["Orange Room"]);
  });
});

describe("spacebring_book_space", () => {
  it("resolves member + space by name, checks the slot, then books in UTC", async () => {
    const bookings = [];
    const { calls } = mockFetch(spacebringRoutes({ bookings }));
    const res = await server.call("spacebring_book_space", {
      ...SLOT,
      member_email: "  Ana@Example.com ",
      space: "blue",
      start_time: "2pm",
    });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("BOOKED");
    expect(res.data.summary).toBe(
      "Booked Blue Room for Ana Silva, Tue, 15 Jun 2027, 14:00–15:00 (Europe/Lisbon).",
    );
    expect(writes(calls)).toEqual(["POST /resources/bookings/v1"]);
    expect(bookings[0]).toMatchObject({
      resourceRef: "res-blue",
      membershipRefOwner: "mem-1",
      startDate: "2027-06-15T13:00:00.000Z",
      endDate: "2027-06-15T14:00:00.000Z",
    });
  });

  it("refuses a taken slot without writing, naming the conflict and free alternatives", async () => {
    const { calls } = mockFetch(spacebringRoutes({ bookings: [ORANGE_BUSY] }));
    const res = await server.call("spacebring_book_space", {
      ...SLOT,
      member_email: "ana@example.com",
      space: "Orange Room",
    });
    expect(res.isError).toBe(true);
    const err = JSON.parse(res.text);
    expect(err.code).toBe("PRECONDITION");
    expect(err.message).toContain("already booked 14:30–15:30");
    expect(err.message).toContain("Free at that time: Blue Room");
    expect(writes(calls)).toEqual([]);
  });

  it("asks which space when the name is ambiguous", async () => {
    const { calls } = mockFetch(spacebringRoutes());
    const res = await server.call("spacebring_book_space", {
      ...SLOT,
      member_email: "ana@example.com",
      space: "room",
    });
    const err = JSON.parse(res.text);
    expect(err.code).toBe("BAD_INPUT");
    expect(err.details.matches.map((s) => s.name)).toEqual(["Orange Room", "Blue Room"]);
    expect(writes(calls)).toEqual([]);
  });

  it("tells the agent what to ask when the email is not a member", async () => {
    mockFetch(spacebringRoutes());
    const res = await server.call("spacebring_book_space", {
      ...SLOT,
      member_email: "nobody@example.com",
      space: "blue",
    });
    const err = JSON.parse(res.text);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toContain("email they use to sign in to Spacebring");
  });

  it("relays Spacebring's own refusal reason", async () => {
    mockFetch(
      spacebringRoutes({
        extra: [
          {
            method: "POST",
            path: "/resources/bookings/v1",
            reply: () => ({ status: 422, body: { error: { message: "Not enough credits" } } }),
          },
        ],
      }),
    );
    const res = await server.call("spacebring_book_space", {
      ...SLOT,
      member_email: "ana@example.com",
      space: "blue",
    });
    const err = JSON.parse(res.text);
    expect(err.code).toBe("BAD_INPUT");
    expect(err.message).toBe("Spacebring refused: Not enough credits");
  });
});

describe("spacebring_move_booking", () => {
  it("books the new slot before cancelling the old one, keeping the length", async () => {
    const bookings = [{ ...ANA_BOOKING }];
    const { calls } = mockFetch(spacebringRoutes({ bookings }));
    const res = await server.call("spacebring_move_booking", {
      member_email: "ana@example.com",
      new_start_time: "11:00",
    });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("MOVED");
    expect(writes(calls)).toEqual([
      "POST /resources/bookings/v1",
      "DELETE /resources/bookings/v1/bk-ana",
    ]);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      resourceRef: "res-blue",
      title: "Standup",
      startDate: "2027-06-16T10:00:00.000Z",
      endDate: "2027-06-16T11:00:00.000Z",
    });
  });

  it("keeps the new booking and says so when the old one cannot be cancelled", async () => {
    const bookings = [{ ...ANA_BOOKING }];
    mockFetch(
      spacebringRoutes({
        bookings,
        extra: [
          {
            method: "DELETE",
            path: "/resources/bookings/v1/bk-ana",
            reply: () => ({ status: 409, body: { message: "Booking is locked" } }),
          },
        ],
      }),
    );
    const res = await server.call("spacebring_move_booking", {
      member_email: "ana@example.com",
      new_start_time: "11:00",
    });
    expect(res.isError).toBe(false);
    expect(res.data.status).toBe("NEW_BOOKED_OLD_KEPT");
    expect(res.data.next).toContain("booking_id bk-ana");
  });

  it("does not touch the current booking when the new slot is taken", async () => {
    const busy = {
      ...ORANGE_BUSY,
      startDate: "2027-06-16T10:00:00.000Z",
      endDate: "2027-06-16T11:00:00.000Z",
    };
    const { calls } = mockFetch(spacebringRoutes({ bookings: [{ ...ANA_BOOKING }, busy] }));
    const res = await server.call("spacebring_move_booking", {
      member_email: "ana@example.com",
      new_start_time: "11:00",
      new_space: "orange",
    });
    const err = JSON.parse(res.text);
    expect(err.code).toBe("PRECONDITION");
    expect(err.message).toContain("is unchanged");
    expect(writes(calls)).toEqual([]);
  });
});

describe("spacebring_cancel_booking", () => {
  it("cancels the member's only upcoming booking without an id", async () => {
    const bookings = [{ ...ANA_BOOKING }, { ...ORANGE_BUSY }];
    const { calls } = mockFetch(spacebringRoutes({ bookings }));
    const res = await server.call("spacebring_cancel_booking", { member_email: "ana@example.com" });
    expect(res.data.summary).toBe(
      "Cancelled Blue Room, Wed, 16 Jun 2027, 10:00–11:00 (Europe/Lisbon).",
    );
    expect(writes(calls)).toEqual(["DELETE /resources/bookings/v1/bk-ana"]);
  });

  it("refuses another member's booking", async () => {
    const { calls } = mockFetch(spacebringRoutes({ bookings: [{ ...ORANGE_BUSY }] }));
    const res = await server.call("spacebring_cancel_booking", {
      member_email: "ana@example.com",
      booking_id: "bk-other",
    });
    expect(JSON.parse(res.text).code).toBe("PRECONDITION");
    expect(writes(calls)).toEqual([]);
  });

  it("lists the bookings to ask from when several are upcoming", async () => {
    const second = {
      ...ANA_BOOKING,
      id: "bk-ana-2",
      startDate: "2027-06-17T09:00:00.000Z",
      endDate: "2027-06-17T10:00:00.000Z",
    };
    mockFetch(spacebringRoutes({ bookings: [{ ...ANA_BOOKING }, second] }));
    const res = await server.call("spacebring_cancel_booking", { member_email: "ana@example.com" });
    const err = JSON.parse(res.text);
    expect(err.code).toBe("BAD_INPUT");
    expect(err.details.bookings.map((b) => b.id)).toEqual(["bk-ana", "bk-ana-2"]);

    const narrowed = await server.call("spacebring_cancel_booking", {
      member_email: "ana@example.com",
      date: "2027-06-17",
    });
    expect(narrowed.data.booking.id).toBe("bk-ana-2");
  });
});

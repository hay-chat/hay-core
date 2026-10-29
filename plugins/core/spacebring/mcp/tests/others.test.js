import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createFakeServer, mockFetch } = require("./harness");
const { LOCATION, spacebringRoutes } = require("./fixtures");
const { registerMemberTools } = require("../tools/members");
const { registerGuestTools } = require("../tools/guests");
const { registerSupportTools, ticketTypeFor } = require("../tools/support");
const { registerCommunityTools } = require("../tools/community");
const { resetCaches } = require("../lib/spacebring");

process.env.SPACEBRING_API_KEY_ID = "key-id";
process.env.SPACEBRING_API_KEY_SECRET = "key-secret";

let server;
beforeEach(() => {
  resetCaches();
  delete process.env.SPACEBRING_LOCATION_REF;
  server = createFakeServer();
  registerMemberTools(server);
  registerGuestTools(server);
  registerSupportTools(server);
  registerCommunityTools(server);
});

const VISIT = {
  id: "vis-1",
  userRefHost: "user-1",
  date: "2027-06-15T09:00:00.000Z",
  visitor: { name: "João", surname: "Costa", email: "joao@example.com" },
};

describe("locations", () => {
  it("asks which location when there are several and no default", async () => {
    mockFetch([
      {
        path: "/locations/v1",
        reply: () => ({ locations: [LOCATION, { id: "loc-2", name: "Porto Hub" }] }),
      },
    ]);
    const res = await server.call("spacebring_list_plans", {});
    const err = JSON.parse(res.text);
    expect(err.code).toBe("BAD_INPUT");
    expect(err.message).toContain("Lisbon Hub, Porto Hub");
  });

  it("accepts a location by partial name", async () => {
    const { calls } = mockFetch([
      {
        path: "/locations/v1",
        reply: () => ({ locations: [LOCATION, { id: "loc-2", name: "Porto Hub" }] }),
      },
      {
        path: "/plans/v1",
        reply: () => ({ plans: [{ name: "Hot desk", price: 150, currency: "EUR" }] }),
      },
    ]);
    const res = await server.call("spacebring_list_plans", { location: "porto" });
    expect(res.data.plans[0]).toMatchObject({ name: "Hot desk", price: 150 });
    expect(calls.at(-1).query.get("locationRef")).toBe("loc-2");
  });
});

describe("spacebring_get_member", () => {
  it("merges membership, bookings, visits and open tickets in one call", async () => {
    mockFetch(
      spacebringRoutes({
        bookings: [
          {
            id: "bk-1",
            resourceRef: "res-blue",
            membershipRefOwner: "mem-1",
            startDate: "2027-06-16T09:00:00.000Z",
            endDate: "2027-06-16T10:00:00.000Z",
          },
        ],
        extra: [
          { path: "/visitors/visits/v1", reply: () => ({ visits: [VISIT] }) },
          {
            path: "/support/tickets/v1",
            reply: () => ({
              tickets: [
                {
                  id: "t-1",
                  userRefRequester: "user-1",
                  status: "open",
                  type: "internet",
                  text: "Wi-Fi down",
                },
                { id: "t-2", userRefRequester: "user-1", status: "resolved", type: "cleaning" },
                { id: "t-3", userRefRequester: "user-9", status: "open", type: "printing" },
              ],
            }),
          },
        ],
      }),
    );
    const res = await server.call("spacebring_get_member", { member_email: "ana@example.com" });
    expect(res.data.member).toMatchObject({
      name: "Ana Silva",
      membershipId: "mem-1",
      credits: 10,
    });
    expect(res.data.upcomingBookings).toEqual([
      expect.objectContaining({ id: "bk-1", space: "Blue Room" }),
    ]);
    expect(res.data.upcomingGuestVisits.map((v) => v.guest)).toEqual(["João Costa"]);
    expect(res.data.openTickets.map((t) => t.id)).toEqual(["t-1"]);
  });
});

describe("spacebring_invite_guest", () => {
  it("splits the name, defaults the arrival and attributes the host", async () => {
    let posted;
    mockFetch(
      spacebringRoutes({
        extra: [
          {
            method: "POST",
            path: "/visitors/visits/v1",
            reply: ({ body }) => {
              posted = body.visit;
              return { visit: { id: "vis-9", ...body.visit } };
            },
          },
        ],
      }),
    );
    const res = await server.call("spacebring_invite_guest", {
      member_email: "ana@example.com",
      guest_name: "João Pedro Costa",
      guest_email: " JOAO@example.com",
      date: "2027-06-15",
    });
    expect(res.data.status).toBe("INVITED");
    expect(posted).toMatchObject({
      date: "2027-06-15T08:00:00.000Z",
      locationRef: "loc-1",
      userRefHost: "user-1",
      visitor: { name: "João Pedro", surname: "Costa", email: "joao@example.com" },
    });
    expect(res.data.summary).toContain("Arrival time defaulted to 09:00");
  });
});

describe("spacebring_cancel_guest_visit", () => {
  it("finds the visit by guest name and cancels it", async () => {
    const { calls } = mockFetch(
      spacebringRoutes({
        extra: [
          { path: "/visitors/visits/v1", reply: () => ({ visits: [VISIT] }) },
          {
            method: "DELETE",
            path: "/visitors/visits/v1/vis-1",
            reply: () => ({ status: 204, body: null }),
          },
        ],
      }),
    );
    const res = await server.call("spacebring_cancel_guest_visit", {
      member_email: "ana@example.com",
      guest_name: "joao",
    });
    expect(res.data.status).toBe("CANCELLED");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
      "/visitors/visits/v1/vis-1",
    ]);
  });
});

describe("spacebring_report_issue", () => {
  it.each([
    [undefined, "The wifi keeps dropping", "internet"],
    [undefined, "AC in the Orange Room is not cooling", "temperatureAndVentilation"],
    [undefined, "My access card does not open the door", "access"],
    ["printer", "it jams", "printing"],
    ["repairAndMaintenance", "chair", "repairAndMaintenance"],
    [undefined, "something odd", "other"],
  ])("maps (%s, %s) to %s", (category, text, type) => {
    expect(ticketTypeFor(category, text)).toBe(type);
  });

  it("files the ticket on behalf of the member", async () => {
    let posted;
    mockFetch(
      spacebringRoutes({
        extra: [
          {
            method: "POST",
            path: "/support/tickets/v1",
            reply: ({ body }) => {
              posted = body.ticket;
              return { ticket: { id: "t-9", status: "open", ...body.ticket } };
            },
          },
        ],
      }),
    );
    const res = await server.call("spacebring_report_issue", {
      description: "Wi-Fi is down on the 2nd floor",
      member_email: "ana@example.com",
    });
    expect(posted).toMatchObject({
      type: "internet",
      userRefRequester: "user-1",
      locationRef: "loc-1",
    });
    expect(res.data.summary).toContain('as "internet" on behalf of Ana Silva');
  });
});

describe("spacebring_search_guides", () => {
  const GUIDES = [
    { id: "g-1", title: "Wi-Fi", content: "Short" },
    { id: "g-2", title: "House rules", content: "Be kind. Quiet hours after 18:00." },
    { id: "g-3", title: "Printing", content: "Use the printer on floor 1." },
  ];

  it("ranks by title and fetches the full text of the best match", async () => {
    const { calls } = mockFetch([
      { path: "/locations/v1", reply: () => ({ locations: [LOCATION] }) },
      { path: "/guides/v1", reply: () => ({ guides: GUIDES }) },
      {
        path: "/guides/v1/g-1",
        reply: () => ({
          guide: { id: "g-1", title: "Wi-Fi", content: "Network: HubGuest / password: coffee123" },
        }),
      },
    ]);
    const res = await server.call("spacebring_search_guides", {
      query: "what's the wifi password?",
    });
    expect(res.data.matches[0]).toEqual({
      title: "Wi-Fi",
      content: "Network: HubGuest / password: coffee123",
    });
    expect(calls.map((c) => c.path)).toContain("/guides/v1/g-1");
  });

  it("says so instead of guessing when nothing matches", async () => {
    mockFetch([
      { path: "/locations/v1", reply: () => ({ locations: [LOCATION] }) },
      { path: "/guides/v1", reply: () => ({ guides: GUIDES }) },
    ]);
    const res = await server.call("spacebring_search_guides", { query: "sauna" });
    expect(res.data.matches).toEqual([]);
    expect(res.data.summary).toContain("Do not guess");
  });
});

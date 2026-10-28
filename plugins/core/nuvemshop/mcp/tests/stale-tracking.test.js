import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeOrder, makeFulfillment } = require("./fixtures");
const { enrichOrder, normalizeFulfillment } = require("../lib/orders");

const now = new Date("2026-10-28T12:00:00Z");

function shipped(events) {
  return normalizeFulfillment(
    makeFulfillment({
      status: "DISPATCHED",
      tracking_info: { code: "BR1" },
      tracking_events: events,
    }),
  );
}

describe("supportSummary.tracking (D6-9)", () => {
  it("flags a shipment whose last carrier event is older than 5 days (domestic)", () => {
    const row = shipped([
      { status: "dispatched", happened_at: "2026-10-15T10:00:00Z" },
      { status: "in_transit", happened_at: "2026-10-20T10:00:00Z" },
    ]);
    const s = enrichOrder(makeOrder({ shipping_status: "shipped" }), [row], null, {
      originCountry: "BR",
      now,
    }).supportSummary.tracking;
    expect(s).toMatchObject({
      isStale: true,
      staleReason: "NO_CARRIER_UPDATE",
      daysSinceLastUpdate: 8,
      thresholdDays: 5,
      lastEventAt: "2026-10-20T10:00:00Z",
    });
  });

  it("does not flag a delivered shipment or an order that has not shipped", () => {
    const delivered = shipped([
      { status: "dispatched", happened_at: "2026-10-01T10:00:00Z" },
      { status: "delivered", happened_at: "2026-10-03T10:00:00Z" },
    ]);
    expect(
      enrichOrder(makeOrder(), [delivered], null, { now }).supportSummary.tracking.isStale,
    ).toBe(false);
    expect(
      enrichOrder(makeOrder(), [normalizeFulfillment(makeFulfillment())], null, { now })
        .supportSummary.tracking,
    ).toMatchObject({ isStale: false, shippedAt: null });
  });
});

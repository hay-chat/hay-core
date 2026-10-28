import { describe, it, expect } from "vitest";
import { staleTracking, stalestShipment, thresholdsFromEnv } from "./index.cjs";

const now = new Date("2026-10-28T12:00:00Z");
const thresholds = { domesticDays: 5, internationalDays: 10 };

describe("staleTracking", () => {
  it("flags a domestic shipment with no movement for more than 5 days", () => {
    const r = staleTracking({ shippedAt: "2026-10-20T12:00:00Z", now, thresholds });
    expect(r).toMatchObject({
      daysSinceLastUpdate: 8,
      thresholdDays: 5,
      international: false,
      isStale: true,
      staleReason: "NOT_DELIVERED_SINCE_SHIPPED",
    });
  });

  it("uses the last carrier event when there is one", () => {
    const moving = staleTracking({
      shippedAt: "2026-10-10T00:00:00Z",
      lastEventAt: "2026-10-26T00:00:00Z",
      now,
      thresholds,
    });
    expect(moving).toMatchObject({ daysSinceLastUpdate: 2, isStale: false });
    const stuck = staleTracking({
      shippedAt: "2026-10-10T00:00:00Z",
      lastEventAt: "2026-10-15T00:00:00Z",
      now,
      thresholds,
    });
    expect(stuck).toMatchObject({ isStale: true, staleReason: "NO_CARRIER_UPDATE" });
  });

  it("gives international shipments the longer threshold", () => {
    const r = staleTracking({
      shippedAt: "2026-10-20T12:00:00Z",
      originCountry: "BR",
      destinationCountry: "PT",
      now,
      thresholds,
    });
    expect(r).toMatchObject({ international: true, thresholdDays: 10, isStale: false });
  });

  it("never flags delivered or unshipped orders", () => {
    expect(
      staleTracking({
        shippedAt: "2026-09-01T00:00:00Z",
        deliveredAt: "2026-09-03T00:00:00Z",
        now,
        thresholds,
      }).isStale,
    ).toBe(false);
    expect(staleTracking({ shippedAt: null, now, thresholds })).toMatchObject({
      isStale: false,
      daysSinceLastUpdate: null,
    });
  });

  it("reads per-store thresholds from env and ignores bad values", () => {
    expect(
      thresholdsFromEnv({
        STALE_TRACKING_DOMESTIC_DAYS: "7",
        STALE_TRACKING_INTERNATIONAL_DAYS: "x",
      }),
    ).toEqual({ domesticDays: 7, internationalDays: 10 });
  });

  it("picks the stalest of several shipments", () => {
    const a = staleTracking({ shippedAt: "2026-10-27T00:00:00Z", now, thresholds });
    const b = staleTracking({ shippedAt: "2026-10-01T00:00:00Z", now, thresholds });
    expect(stalestShipment([a, null, b])).toBe(b);
    expect(stalestShipment([])).toBeNull();
  });
});

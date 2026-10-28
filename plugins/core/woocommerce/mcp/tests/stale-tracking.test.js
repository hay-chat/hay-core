import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { enrichOrder } = require("../lib/orders");

const now = new Date("2026-10-28T12:00:00Z");
const order = {
  id: 1,
  number: "1",
  status: "completed",
  currency: "BRL",
  total: "50.00",
  date_paid: "2026-10-01T10:00:00",
  shipping: { country: "BR" },
  refunds: [],
};

describe("supportSummary.tracking (D6-9)", () => {
  it("flags a recorded shipment with no delivery after 5 days (domestic)", () => {
    const s = enrichOrder(order, [{ trackingNumber: "BR1", shippedAt: "2026-10-20T00:00:00Z" }], {
      originCountry: "BR",
      now,
    }).supportSummary.tracking;
    expect(s).toMatchObject({
      isStale: true,
      staleReason: "NOT_DELIVERED_SINCE_SHIPPED",
      thresholdDays: 5,
      international: false,
    });
  });

  it("uses the 10-day international threshold when the destination differs", () => {
    const s = enrichOrder(
      { ...order, shipping: { country: "PT" } },
      [{ trackingNumber: "BR1", shippedAt: "2026-10-20T00:00:00Z" }],
      { originCountry: "BR", now },
    ).supportSummary.tracking;
    expect(s).toMatchObject({ isStale: false, international: true, thresholdDays: 10 });
  });

  it("does not flag a completed order with no tracking recorded", () => {
    expect(enrichOrder(order, [], { now }).supportSummary.tracking.isStale).toBe(false);
  });
});

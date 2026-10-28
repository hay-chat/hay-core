import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { enrichOrder } = require("../lib/orders");

const now = new Date("2026-10-28T12:00:00Z");
const order = (country, status = "APPROVED") => ({
  id: "o1",
  number: "1001",
  status,
  fulfillmentStatus: "FULFILLED",
  currency: "EUR",
  shippingInfo: { logistics: { shippingDestination: { address: { country } } } },
});
const shipped = (createdDate) => [{ id: "f1", createdDate, trackingInfo: { trackingNumber: "T1" } }];

describe("supportSummary.tracking (D6-9)", () => {
  it("flags a fulfilment older than 5 days on a domestic order", () => {
    const s = enrichOrder(order("PT"), null, shipped("2026-10-20T00:00:00Z"), {
      originCountry: "PT",
      now,
    }).supportSummary.tracking;
    expect(s).toMatchObject({
      isStale: true,
      staleReason: "NOT_DELIVERED_SINCE_SHIPPED",
      thresholdDays: 5,
      international: false,
      daysSinceLastUpdate: 8,
    });
  });

  it("uses the 10-day international threshold when the destination differs", () => {
    const s = enrichOrder(order("US"), null, shipped("2026-10-20T00:00:00Z"), {
      originCountry: "PT",
      now,
    }).supportSummary.tracking;
    expect(s).toMatchObject({ isStale: false, international: true, thresholdDays: 10 });
  });

  it("does not flag an unshipped or cancelled order", () => {
    expect(enrichOrder(order("PT"), null, [], { now }).supportSummary.tracking.isStale).toBe(false);
    expect(
      enrichOrder(order("PT", "CANCELED"), null, shipped("2026-10-01T00:00:00Z"), { now })
        .supportSummary.tracking.isStale,
    ).toBe(false);
  });
});

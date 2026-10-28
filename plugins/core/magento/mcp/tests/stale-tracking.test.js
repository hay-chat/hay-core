import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { enrichOrder } = require("../lib/orders");

const now = new Date("2026-10-28T12:00:00Z");
const order = (state = "complete") => ({
  entity_id: 1,
  increment_id: "000000001",
  state,
  status: state,
  order_currency_code: "EUR",
  total_paid: "50.00",
  items: [],
  extension_attributes: {
    shipping_assignments: [{ shipping: { address: { country_id: "PT" } } }],
  },
});
// Magento REST dates are UTC without a zone.
const shipment = (created_at) => ({ entity_id: 9, increment_id: "S1", created_at, tracks: [] });

describe("supportSummary.tracking (D6-9)", () => {
  it("flags a shipment older than the 5-day default (origin unknown counts as domestic)", () => {
    const s = enrichOrder(order(), [shipment("2026-10-20 00:00:00")], [], { now }).supportSummary
      .tracking;
    expect(s).toMatchObject({
      isStale: true,
      staleReason: "NOT_DELIVERED_SINCE_SHIPPED",
      thresholdDays: 5,
      shippedAt: "2026-10-20T00:00:00Z",
      daysSinceLastUpdate: 8,
    });
  });

  it("does not flag a recent shipment, an unshipped order or a closed order", () => {
    expect(
      enrichOrder(order(), [shipment("2026-10-26 00:00:00")], [], { now }).supportSummary.tracking
        .isStale,
    ).toBe(false);
    expect(enrichOrder(order("processing"), [], [], { now }).supportSummary.tracking.isStale).toBe(
      false,
    );
    expect(
      enrichOrder(order("closed"), [shipment("2026-10-01 00:00:00")], [], { now }).supportSummary
        .tracking.isStale,
    ).toBe(false);
  });

  it("honours the store's own threshold", () => {
    process.env.STALE_TRACKING_DOMESTIC_DAYS = "10";
    try {
      expect(
        enrichOrder(order(), [shipment("2026-10-20 00:00:00")], [], { now }).supportSummary
          .tracking,
      ).toMatchObject({ isStale: false, thresholdDays: 10 });
    } finally {
      delete process.env.STALE_TRACKING_DOMESTIC_DAYS;
    }
  });
});

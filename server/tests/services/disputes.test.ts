/**
 * D2-7: matching a reported dispute to an order. No database: the order
 * index is the boundary.
 */
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { orderLinkService, type OrderGroup } from "../../services/order-links/order-link.service";
import { DisputesService } from "../../services/disputes/disputes.service";

const group = (pluginId: string | null, orderKey: string): OrderGroup => ({
  pluginId,
  orderKey,
  orderLabel: orderKey,
  conversationIds: ["c1"],
  lastSeenAt: new Date("2026-10-28T10:00:00Z"),
});

describe("DisputesService.matchOrder", () => {
  const service = new DisputesService({ platformName: () => null });
  const findOrders = jest.spyOn(orderLinkService, "findOrders");

  afterEach(() => findOrders.mockReset());

  it("never matches an order only message text mentions", async () => {
    findOrders.mockResolvedValue([group(null, "1001")]);
    expect(await service.matchOrder("org", "stripe", ["#1001"])).toBeNull();
  });

  it("prefers the reporting plugin, then any plugin that knows the order", async () => {
    findOrders.mockResolvedValue([group(null, "1001"), group("woo", "w1"), group("stripe", "s1")]);
    expect((await service.matchOrder("org", "stripe", ["#1001"]))?.pluginId).toBe("stripe");
    expect((await service.matchOrder("org", "shopify", ["#1001"]))?.pluginId).toBe("woo");
  });

  it("moves on to the next ref when a ref has only text mentions", async () => {
    findOrders.mockImplementation(async (_org, filter) =>
      filter.query === "#2002" ? [group(null, "2002")] : [group("shopify", "5550001")],
    );
    const match = await service.matchOrder("org", "stripe", ["#2002", "#1001"]);
    expect(match?.orderKey).toBe("5550001");
  });
});

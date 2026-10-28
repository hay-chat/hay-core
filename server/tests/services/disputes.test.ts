/**
 * D2-7: dispute intake without a database. The order index and the dispute
 * repository are the boundary (the SQL runs in tests/integration/disputes.test.ts).
 */
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import type { Dispute } from "../../database/entities/dispute.entity";
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

describe("DisputesService.report", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the alertedAt the alert stamped, not the row loaded before it", async () => {
    const alertedAt = new Date("2026-10-28T10:00:00Z");
    const row = {
      id: "d1",
      organizationId: "org",
      pluginId: "stripe",
      externalId: "dp_1",
      status: "needs_response",
      orderKey: "5550001",
      orderRefs: ["#1001"],
      alertedAt: null,
    } as unknown as Dispute;
    const repo = {
      findOne: jest.fn(async () => row),
      update: jest.fn(async () => ({})),
      findOneByOrFail: jest.fn(async () => ({ ...row, alertedAt })),
    };
    jest
      .spyOn(AppDataSource, "getRepository")
      .mockReturnValue(repo as unknown as ReturnType<typeof AppDataSource.getRepository>);
    const service = new DisputesService({ platformName: () => null });
    const alert = jest.spyOn(service, "alert").mockResolvedValue(true);

    const { dispute } = await service.report("org", "stripe", {
      externalId: "dp_1",
      status: "needs_response",
    });
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), "opened");
    expect(dispute.alertedAt).toEqual(alertedAt);
  });
});

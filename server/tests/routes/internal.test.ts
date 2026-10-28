import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * internal.organizations.* — operator-only procedures behind the shared secret.
 */

const mockConfig = { internal: { apiSecret: "s3cret" } };
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockSetAccessState = jest.fn();
const mockGetAccessState = jest.fn();
const mockSetBillingPeriod = jest.fn();
const mockSetLimits = jest.fn();
jest.mock("@server/services/organization-access.service", () => ({
  organizationAccessService: {
    setAccessState: mockSetAccessState,
    getAccessState: mockGetAccessState,
    setBillingPeriod: mockSetBillingPeriod,
    setLimits: mockSetLimits,
  },
}));

const mockListPendingExclusions = jest.fn();
const mockReviewExclusion = jest.fn();
jest.mock("@server/services/resolution-ledger.service", () => ({
  resolutionLedgerService: {
    listPendingExclusions: mockListPendingExclusions,
    reviewExclusion: mockReviewExclusion,
  },
}));

const mockFindOne = jest.fn();
const mockDeleteWithData = jest.fn();
jest.mock("@server/services/organization.service", () => ({
  organizationService: { findOne: mockFindOne, deleteWithData: mockDeleteWithData },
}));

import { internalRouter } from "@server/routes/v1/internal";
import { INTERNAL_SECRET_HEADER } from "@server/trpc/middleware/internal";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ctx = (secret = "s3cret"): Context =>
  ({
    user: null,
    organizationId: null,
    req: { headers: { [INTERNAL_SECRET_HEADER]: secret } },
    res: {},
  }) as unknown as Context;

const state = {
  suspendedAt: new Date(),
  suspensionReason: "trial_expired",
  suspensionRedirectUrl: null,
  agentPausedAt: null,
  agentPauseReason: null,
  accessNotice: null,
};

describe("internal.organizations", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires the shared secret", async () => {
    await expect(
      internalRouter
        .createCaller(ctx("wrong"))
        .organizations.getAccessState({ organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("validates the suspension reason", async () => {
    await expect(
      internalRouter.createCaller(ctx()).organizations.setAccessState({
        organizationId: ORG_ID,
        // @ts-expect-error - invalid reason on purpose
        suspension: { reason: "because" },
        notice: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockSetAccessState).not.toHaveBeenCalled();
  });

  it("passes a valid state through and returns the result", async () => {
    mockSetAccessState.mockResolvedValueOnce(state);
    const result = await internalRouter.createCaller(ctx()).organizations.setAccessState({
      organizationId: ORG_ID,
      suspension: { reason: "trial_expired", redirectUrl: "https://hay.chat/billing/locked/" },
      notice: { key: "trial_expired", level: "critical", ctaUrl: "https://hay.chat/billing/" },
    });
    expect(result).toEqual(state);
    expect(mockSetAccessState).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        suspension: { reason: "trial_expired", redirectUrl: "https://hay.chat/billing/locked/" },
        // omitted by the caller -> defaults to "not paused"
        agentPause: null,
      }),
    );
  });

  it("validates the agent pause reason and passes a valid pause through", async () => {
    await expect(
      internalRouter.createCaller(ctx()).organizations.setAccessState({
        organizationId: ORG_ID,
        suspension: null,
        // @ts-expect-error - invalid reason on purpose
        agentPause: { reason: "because" },
        notice: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockSetAccessState).not.toHaveBeenCalled();

    mockSetAccessState.mockResolvedValueOnce({
      ...state,
      suspendedAt: null,
      suspensionReason: null,
      agentPausedAt: new Date(),
      agentPauseReason: "usage_limit",
    });
    await internalRouter.createCaller(ctx()).organizations.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: { reason: "usage_limit" },
      notice: { key: "usage_paused", level: "critical" },
    });
    expect(mockSetAccessState).toHaveBeenCalledWith(
      expect.objectContaining({ suspension: null, agentPause: { reason: "usage_limit" } }),
    );
  });

  it.each([
    ["usage_cap_reached", { used: "1,200", cap: "1,200", periodEnd: "2026-11-01" }],
    ["trial_grace", { lockDate: "2026-11-03" }],
    ["manual_suspension_pending", { date: "2026-11-05", reason: "Terms review." }],
  ])("passes the %s notice key and params through unchanged", async (key, params) => {
    mockSetAccessState.mockResolvedValueOnce(state);
    const notice = {
      key,
      level: "critical" as const,
      params,
      text: "Fallback text",
      ctaUrl: "https://hay.chat/billing/",
      ctaLabel: "Open",
      expiresAt: "2026-11-05T00:00:00.000Z",
    };
    await internalRouter.createCaller(ctx()).organizations.setAccessState({
      organizationId: ORG_ID,
      suspension: null,
      agentPause: { reason: "usage_limit" },
      notice,
    });
    expect(mockSetAccessState).toHaveBeenCalledWith(expect.objectContaining({ notice }));
  });

  it("maps an unknown organization to NOT_FOUND", async () => {
    mockSetAccessState.mockResolvedValueOnce(null);
    await expect(
      internalRouter.createCaller(ctx()).organizations.setAccessState({
        organizationId: ORG_ID,
        suspension: null,
        notice: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    mockGetAccessState.mockResolvedValueOnce(null);
    await expect(
      internalRouter.createCaller(ctx()).organizations.getAccessState({ organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("passes the billing period through as dates and refuses an empty one", async () => {
    mockSetBillingPeriod.mockResolvedValueOnce(state);
    await internalRouter.createCaller(ctx()).organizations.setBillingPeriod({
      organizationId: ORG_ID,
      period: { start: "2026-10-14T09:30:00.000Z", end: "2026-11-14T09:30:00.000Z" } as never,
    });
    expect(mockSetBillingPeriod).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      period: {
        start: new Date("2026-10-14T09:30:00.000Z"),
        end: new Date("2026-11-14T09:30:00.000Z"),
      },
    });

    await expect(
      internalRouter.createCaller(ctx()).organizations.setBillingPeriod({
        organizationId: ORG_ID,
        period: { start: new Date("2026-10-14"), end: new Date("2026-10-14") },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    mockSetBillingPeriod.mockResolvedValueOnce(null);
    await expect(
      internalRouter
        .createCaller(ctx())
        .organizations.setBillingPeriod({ organizationId: ORG_ID, period: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sets the simulation allowance and validates it", async () => {
    mockSetLimits.mockResolvedValueOnce({ maxSimulationsPerMonth: 100 });
    await expect(
      internalRouter
        .createCaller(ctx())
        .organizations.setLimits({ organizationId: ORG_ID, maxSimulationsPerMonth: 100 }),
    ).resolves.toEqual({ maxSimulationsPerMonth: 100 });
    await expect(
      internalRouter
        .createCaller(ctx())
        .organizations.setLimits({ organizationId: ORG_ID, maxSimulationsPerMonth: -1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    mockSetLimits.mockResolvedValueOnce(null);
    await expect(
      internalRouter
        .createCaller(ctx())
        .organizations.setLimits({ organizationId: ORG_ID, maxSimulationsPerMonth: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes through organizationService.deleteWithData", async () => {
    const organization = { id: ORG_ID, name: "Acme" };
    mockFindOne.mockResolvedValueOnce(organization);
    mockDeleteWithData.mockResolvedValueOnce(undefined);

    await expect(
      internalRouter.createCaller(ctx()).organizations.delete({ organizationId: ORG_ID }),
    ).resolves.toEqual({ success: true });
    expect(mockDeleteWithData).toHaveBeenCalledWith(organization);

    mockFindOne.mockResolvedValueOnce(null);
    await expect(
      internalRouter.createCaller(ctx()).organizations.delete({ organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists pending exclusions and passes a review decision with the reviewer through", async () => {
    mockListPendingExclusions.mockResolvedValueOnce([]);
    await internalRouter.createCaller(ctx()).resolutions.listPendingExclusions({});
    expect(mockListPendingExclusions).toHaveBeenCalledWith({ limit: 100 });

    mockReviewExclusion.mockResolvedValueOnce({ status: "denied" });
    const outcomeId = "22222222-2222-4222-8222-222222222222";
    await expect(
      internalRouter.createCaller(ctx()).resolutions.reviewExclusion({
        organizationId: ORG_ID,
        outcomeId,
        decision: "deny",
        reviewer: "  roger  ",
      }),
    ).resolves.toEqual({ status: "denied" });
    expect(mockReviewExclusion).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      outcomeId,
      decision: "deny",
      reviewer: "roger",
    });

    await expect(
      internalRouter.createCaller(ctx()).resolutions.reviewExclusion({
        organizationId: ORG_ID,
        outcomeId,
        decision: "approve",
        reviewer: " ",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      internalRouter
        .createCaller(ctx("wrong"))
        .resolutions.listPendingExclusions({ organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

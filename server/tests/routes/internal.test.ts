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
jest.mock("@server/services/organization-access.service", () => ({
  organizationAccessService: {
    setAccessState: mockSetAccessState,
    getAccessState: mockGetAccessState,
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
      }),
    );
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
});

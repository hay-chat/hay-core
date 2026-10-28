import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * organizations.updateSettings actionApproval: only the owner may weaken the
 * approval rule. Raising the threshold is weakening it (a huge threshold means
 * nothing needs approval); lowering it is not.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockFindOne = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdate = jest.fn<(id: string, data: unknown) => Promise<unknown>>();
jest.mock("@server/services/organization.service", () => ({
  organizationService: {
    findOne: (id: string) => mockFindOne(id),
    update: (id: string, data: unknown) => mockUpdate(id, data),
  },
}));
jest.mock("@server/services/llm/llm-provider.factory", () => ({
  llmProviderFactory: { invalidate: jest.fn() },
}));

import { organizationsRouter } from "@server/routes/v1/organizations";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const callerAs = (role: "owner" | "admin") =>
  organizationsRouter.createCaller({
    user: {
      id: "user-1",
      hasScope: () => true,
      getRole: () => role,
      userOrganization: { organization: {} },
    },
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context);

describe("organizations.updateSettings action approval threshold", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const org = {
      id: ORG_ID,
      name: "Shop",
      settings: { actionApproval: { moneyMovesNeedApproval: true, thresholdAmount: 100 } },
    };
    mockFindOne.mockResolvedValue(org);
    mockUpdate.mockImplementation(async (_id, data) => ({ ...org, ...(data as object) }));
  });

  it("refuses an admin raising the threshold", async () => {
    await expect(
      callerAs("admin").updateSettings({ actionApproval: { thresholdAmount: 1_000_000 } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lets an admin lower the threshold or keep it", async () => {
    await callerAs("admin").updateSettings({ actionApproval: { thresholdAmount: 50 } });
    await callerAs("admin").updateSettings({ actionApproval: { thresholdAmount: 100 } });
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("lets the owner raise the threshold", async () => {
    await callerAs("owner").updateSettings({ actionApproval: { thresholdAmount: 1_000_000 } });
    expect(mockUpdate).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        settings: expect.objectContaining({
          actionApproval: expect.objectContaining({ thresholdAmount: 1_000_000 }),
        }),
      }),
    );
  });
});

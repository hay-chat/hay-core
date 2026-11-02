import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * organizations.updateSettings confidenceGuardrail: weakening the fact check
 * (escalation off, lower threshold) is owner-only, and switching escalation off
 * needs the typed confirmation.
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

describe("organizations.updateSettings confidence guardrail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const org = { id: ORG_ID, name: "Shop", settings: {} };
    mockFindOne.mockResolvedValue(org);
    mockUpdate.mockImplementation(async (_id, data) => ({ ...org, ...(data as object) }));
  });

  it("refuses an admin switching escalation off", async () => {
    await expect(
      callerAs("admin").updateSettings({
        confidenceGuardrail: { enableEscalation: false, confirmSwitchOff: "SWITCH OFF ESCALATION" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses an admin lowering the threshold", async () => {
    await expect(
      callerAs("admin").updateSettings({ confidenceGuardrail: { mediumThreshold: 0 } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs the typed confirmation from the owner too", async () => {
    await expect(
      callerAs("owner").updateSettings({ confidenceGuardrail: { enableEscalation: false } }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("lets the owner switch escalation off with the confirmation, without storing it", async () => {
    await callerAs("owner").updateSettings({
      confidenceGuardrail: { enableEscalation: false, confirmSwitchOff: "SWITCH OFF ESCALATION" },
    });
    const [, data] = mockUpdate.mock.calls[0] as [string, { settings: Record<string, object> }];
    expect(data.settings.confidenceGuardrail).toEqual({ enableEscalation: false });
  });

  it("lets an admin save unchanged or stricter settings", async () => {
    await callerAs("admin").updateSettings({
      confidenceGuardrail: { enableEscalation: true, mediumThreshold: 0.7, enableRecheck: false },
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

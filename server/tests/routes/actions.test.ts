import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * actions.approve: an API key decides with no user id (decided_by is a users
 * FK), and an approve refused because the conversation is closed reaches the
 * dashboard as a clear error.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: async () => ({ settings: {} }) },
}));

const mockApprove = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@server/services/action-decision.service", () => ({
  actionDecisionService: { approve: (...args: unknown[]) => mockApprove(...args) },
}));

import { actionsRouter } from "@server/routes/v1/actions";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";
const apiKeyCaller = () =>
  actionsRouter.createCaller({
    user: {
      id: "api-token-key-1",
      authMethod: "apikey",
      apiKeyId: "key-1",
      hasScope: () => true,
      getRole: () => undefined,
    },
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context);

describe("actions.approve", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes an API key caller as no user plus its key id", async () => {
    mockApprove.mockResolvedValue({ action: { id: ACTION_ID }, transitioned: true });
    await apiKeyCaller().approve({ id: ACTION_ID });
    expect(mockApprove).toHaveBeenCalledWith(ACTION_ID, ORG_ID, {
      userId: null,
      apiKeyId: "key-1",
    });
  });

  it("reports a closed conversation as a precondition error", async () => {
    mockApprove.mockResolvedValue({
      action: { id: ACTION_ID },
      transitioned: false,
      blocked: "conversation_closed",
    });
    await expect(apiKeyCaller().approve({ id: ACTION_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

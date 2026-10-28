import { describe, it, expect, jest } from "@jest/globals";

/**
 * conversations.create / update: "awaiting-approval" is set only by the
 * approval hold, never by a client (it would leave the conversation with no AI
 * reply and no auto-close).
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({})),
}));

import { conversationsRouter } from "@server/routes/v1/conversations";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const caller = () =>
  conversationsRouter.createCaller({
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      hasScope: () => true,
      getRole: () => "owner",
      userOrganization: { organization: {} },
    },
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context);

describe("conversation status input", () => {
  it("create refuses awaiting-approval", async () => {
    await expect(caller().create({ status: "awaiting-approval" as "open" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("update refuses awaiting-approval", async () => {
    await expect(
      caller().update({
        id: "33333333-3333-4333-8333-333333333333",
        data: { status: "awaiting-approval" as "open" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

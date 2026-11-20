import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/audit-log.service", () => ({ auditLogService: { record: jest.fn() } }));
jest.mock("@server/services/websocket.service", () => ({ websocketService: {} }));

type Row = Record<string, unknown>;
const ORG = "33333333-3333-4333-8333-333333333333";
const tokenFindOne = jest.fn<(options: unknown) => Promise<Row | null>>();
const tokenUpdate = jest.fn<(where: unknown, values: unknown) => Promise<unknown>>();

jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ findOne: tokenFindOne, update: tokenUpdate }) },
}));

import { getDatabaseContext } from "@server/database/organization-context";
import { scimService } from "@server/services/scim.service";

const TOKEN = "hay_scim_" + "a".repeat(40);

describe("SCIM token authentication database context", () => {
  beforeEach(() => jest.clearAllMocks());

  it("looks the token up in a system context and records use in its organization", async () => {
    const seen: Record<string, unknown> = {};
    tokenFindOne.mockImplementation(async () => {
      seen.lookup = getDatabaseContext();
      return {
        id: "t1",
        organizationId: ORG,
        lastUsedAt: null,
        organization: { isActive: true, suspendedAt: null },
      };
    });
    tokenUpdate.mockImplementation(async () => {
      seen.update = getDatabaseContext();
    });

    await expect(scimService.authenticate(TOKEN)).resolves.toEqual({
      organizationId: ORG,
      tokenId: "t1",
    });

    expect(seen.lookup).toEqual({ kind: "system", reason: "scim token lookup by token hash" });
    expect(seen.update).toEqual({ kind: "organization", organizationId: ORG });
  });

  it("runs nothing under an organization for an unknown token", async () => {
    const seen: unknown[] = [];
    tokenFindOne.mockImplementation(async () => {
      seen.push(getDatabaseContext());
      return null;
    });

    await expect(scimService.authenticate(TOKEN)).resolves.toBeNull();

    expect(seen).toEqual([{ kind: "system", reason: "scim token lookup by token hash" }]);
    expect(tokenUpdate).not.toHaveBeenCalled();
  });
});

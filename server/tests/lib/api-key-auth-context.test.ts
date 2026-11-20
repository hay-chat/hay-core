import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

type Row = Record<string, unknown>;
const ORG = "33333333-3333-4333-8333-333333333333";
const apiKeyFindOne = jest.fn<(options: unknown) => Promise<Row | null>>();
const apiKeyUpdate = jest.fn<(where: unknown, values: unknown) => Promise<unknown>>();
const organizationFindOne = jest.fn<(options: unknown) => Promise<Row | null>>();

jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) =>
      entity.name === "ApiKey"
        ? { findOne: apiKeyFindOne, update: apiKeyUpdate }
        : { findOne: organizationFindOne },
  },
}));

import { getDatabaseContext } from "@server/database/organization-context";
import { authenticateApiKeyAuth } from "@server/lib/auth/middleware/apiKeyAuth";

const activeOrganization = { id: ORG, slug: "acme", isActive: true, suspendedAt: null };
const storedKey = (over: Row = {}): Row => ({
  id: "k1",
  organizationId: ORG,
  organization: activeOrganization,
  scopes: [],
  lastUsedAt: null,
  isExpired: () => false,
  ...over,
});

describe("API key authentication database context", () => {
  beforeEach(() => jest.clearAllMocks());

  it("looks the key up in a system context and continues in the key's organization", async () => {
    const seen: Record<string, unknown> = {};
    apiKeyFindOne.mockImplementation(async () => {
      seen.lookup = getDatabaseContext();
      return storedKey();
    });
    apiKeyUpdate.mockImplementation(async () => {
      seen.update = getDatabaseContext();
    });

    const user = await authenticateApiKeyAuth("Bearer hay_" + "a".repeat(64));

    expect(user).not.toBeNull();
    expect(seen.lookup).toEqual({ kind: "system", reason: "api key lookup by key hash" });
    expect(seen.update).toEqual({ kind: "organization", organizationId: ORG });
  });

  it("loads a missing organization relation in the key's organization", async () => {
    const seen: Record<string, unknown> = {};
    apiKeyFindOne.mockResolvedValue(storedKey({ organization: undefined }));
    organizationFindOne.mockImplementation(async () => {
      seen.organization = getDatabaseContext();
      return activeOrganization;
    });

    await authenticateApiKeyAuth("Bearer hay_" + "a".repeat(64));

    expect(seen.organization).toEqual({ kind: "organization", organizationId: ORG });
  });

  it("runs nothing under an organization for an unknown key", async () => {
    const seen: unknown[] = [];
    apiKeyFindOne.mockImplementation(async () => {
      seen.push(getDatabaseContext());
      return null;
    });

    await expect(authenticateApiKeyAuth("Bearer hay_" + "b".repeat(64))).rejects.toThrow(
      "Invalid API key",
    );

    expect(seen).toEqual([{ kind: "system", reason: "api key lookup by key hash" }]);
    expect(organizationFindOne).not.toHaveBeenCalled();
    expect(apiKeyUpdate).not.toHaveBeenCalled();
  });
});

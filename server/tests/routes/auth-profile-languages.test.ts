import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { TRPCError } from "@trpc/server";

/**
 * Each person picks their own dashboard language (interface) and the language
 * they read conversations in (translation); both can be cleared.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const mockLogProfileUpdate = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logProfileUpdate: (...args: unknown[]) => mockLogProfileUpdate(...args) },
}));
jest.mock("@server/services/mfa.service", () => ({
  mfaService: {
    assertEnrolledIfRequired: async () => undefined,
    enrolmentRequired: async () => false,
  },
}));

type Row = Record<string, unknown>;
const mockFindOne = jest.fn<() => Promise<Row | null>>();
const mockSave = jest.fn(async (row: Row) => row);
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: () => ({
      findOne: () => mockFindOne(),
      find: async () => [],
      save: (row: Row) => mockSave(row),
    }),
  },
}));

import { authRouter } from "@server/routes/v1/auth";
import type { Context } from "@server/trpc/context";

const caller = authRouter.createCaller({
  user: {
    id: "user-1",
    authMethod: "jwt",
    getUser: () => ({ id: "user-1" }),
    userOrganization: { organization: {} },
  },
  organizationId: "33333333-3333-4333-8333-333333333333",
  req: { headers: {} },
  res: {},
} as unknown as Context);

const storedUser = (over: Row = {}): Row => ({
  id: "user-1",
  email: "ana@example.com",
  firstName: "Ana",
  isActive: true,
  role: "member",
  interfaceLanguage: null,
  translationLanguage: null,
  toJSON() {
    return { ...this };
  },
  getOnlineStatus: () => "online",
  ...over,
});

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  const result = await promise.catch((error: unknown) => error);
  return result instanceof TRPCError ? result.code : undefined;
};

describe("auth.updateProfile languages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(storedUser());
  });

  it("saves the interface and translation languages", async () => {
    const result = await caller.updateProfile({
      interfaceLanguage: "pt-BR",
      translationLanguage: "de",
    });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ interfaceLanguage: "pt-BR", translationLanguage: "de" }),
    );
    expect(result.user).toMatchObject({ interfaceLanguage: "pt-BR", translationLanguage: "de" });
    expect(mockLogProfileUpdate).toHaveBeenCalledWith(
      "user-1",
      {
        interfaceLanguage: { old: null, new: "pt-BR" },
        translationLanguage: { old: null, new: "de" },
      },
      expect.anything(),
    );
  });

  it("turns translation off with null and leaves the interface language alone", async () => {
    mockFindOne.mockResolvedValue(
      storedUser({ interfaceLanguage: "en", translationLanguage: "pt-PT" }),
    );

    await caller.updateProfile({ translationLanguage: null });

    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ interfaceLanguage: "en", translationLanguage: null }),
    );
  });

  it("does not save when nothing changed", async () => {
    mockFindOne.mockResolvedValue(storedUser({ translationLanguage: "fr" }));

    await caller.updateProfile({ translationLanguage: "fr" });

    expect(mockSave).not.toHaveBeenCalled();
  });

  it.each([
    ["an interface language the dashboard has no translation for", { interfaceLanguage: "de" }],
    ["a bare Portuguese interface language", { interfaceLanguage: "pt" }],
    ["an unknown translation language", { translationLanguage: "xx" }],
    ["a translation language in the wrong case", { translationLanguage: "PT-pt" }],
  ])("refuses %s", async (_name, input) => {
    expect(await codeOf(caller.updateProfile(input as never))).toBe("BAD_REQUEST");
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("auth.me languages", () => {
  it("returns the user's languages", async () => {
    mockFindOne.mockResolvedValue(
      storedUser({ interfaceLanguage: "pt-BR", translationLanguage: "zh-Hant" }),
    );

    await expect(caller.me()).resolves.toMatchObject({
      interfaceLanguage: "pt-BR",
      translationLanguage: "zh-Hant",
    });
  });

  it("answers null for unset languages and for an interface language no longer offered", async () => {
    mockFindOne.mockResolvedValue(storedUser({ interfaceLanguage: "fr" }));

    await expect(caller.me()).resolves.toMatchObject({
      interfaceLanguage: null,
      translationLanguage: null,
    });
  });
});

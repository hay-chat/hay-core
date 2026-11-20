import { describe, it, expect, afterEach, jest } from "@jest/globals";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { getDatabaseContext } from "@server/database/organization-context";
import { PrivacyRequestError, privacyService } from "@server/services/privacy.service";

type Scope = ReturnType<typeof getDatabaseContext>;

describe("privacy token paths run in a system context", () => {
  afterEach(() => jest.restoreAllMocks());

  it("confirmRequest runs its whole transaction in a system context and keeps the unknown-token result", async () => {
    const seen: Scope[] = [];
    jest.spyOn(AppDataSource, "transaction").mockImplementation((async (
      work: (manager: EntityManager) => Promise<unknown>,
    ) => {
      seen.push(getDatabaseContext());
      const manager = {
        getRepository: () => ({ findOne: async () => null }),
      } as unknown as EntityManager;
      return work(manager);
    }) as unknown as typeof AppDataSource.transaction);

    await expect(privacyService.confirmExport("unknown-token")).rejects.toThrow(
      new PrivacyRequestError("Invalid or expired verification token"),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "system" });
    expect((seen[0] as { reason: string }).reason).toMatch(/confirm request/);
  });

  it("getStatus looks the request up in a system context and keeps the unknown-id result", async () => {
    const seen: Scope[] = [];
    jest.spyOn(AppDataSource, "getRepository").mockImplementation((() => ({
      findOne: async () => {
        seen.push(getDatabaseContext());
        return null;
      },
    })) as unknown as typeof AppDataSource.getRepository);

    await expect(privacyService.getStatus("00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      new PrivacyRequestError("Privacy request not found"),
    );
    expect(seen[0]).toMatchObject({ kind: "system" });
    expect((seen[0] as { reason: string }).reason).toMatch(/status lookup/);
  });
});

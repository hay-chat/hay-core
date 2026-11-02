import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: async () => undefined },
}));

import { t } from "@server/trpc/init";
import { z } from "zod";
import { createListProcedure } from "@server/trpc/procedures/list";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { User } from "@server/entities/user.entity";
import { RESOURCES } from "@server/types/scopes";
import type { BaseRepository } from "@server/repositories/base.repository";
import type { Context } from "@server/trpc/context";

const paginateQuery = jest.fn(async () => ({ items: [], pagination: {} }));
const router = t.router({
  list: createListProcedure(RESOURCES.CUSTOMERS, z.object({}).passthrough(), {
    paginateQuery,
  } as unknown as BaseRepository<{ id: string }>),
});

const apiKeyCaller = (scopes: Array<{ resource: string; actions: string[] }>) =>
  router.createCaller({
    user: new AuthUser(Object.assign(new User(), { id: "k", isActive: true }), "apikey", {
      scopes,
      organizationId: "org-1",
    }),
    organizationId: "org-1",
    req: { headers: {} },
    res: {},
  } as unknown as Context);

describe("createListProcedure", () => {
  it("requires the resource read scope", async () => {
    await expect(
      apiKeyCaller([{ resource: "analytics", actions: ["read"] }]).list({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(paginateQuery).not.toHaveBeenCalled();
  });

  it("lists with the read scope", async () => {
    await apiKeyCaller([{ resource: "customers", actions: ["read"] }]).list({});
    expect(paginateQuery).toHaveBeenCalled();
  });
});

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Plugin routers run in-process only: they are not served over HTTP, they refuse
 * a context that carries a request, and they look instances up within the
 * calling organization.
 */

const mockFindByIdAndOrganization =
  jest.fn<(id: string, orgId: string) => Promise<Record<string, unknown> | null>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByIdAndOrganization: mockFindByIdAndOrganization },
}));

import { t } from "@server/trpc/init";
import { z } from "zod";
import { pluginRouterRegistry } from "@server/services/plugin-router-registry.service";
import { v1Router } from "@server/routes/v1";
import { confluenceRouter } from "@plugins/core/atlassian/src/router";
import { notionRouter } from "@plugins/core/notion/src/router";
import type { Context } from "@server/trpc/context";

const INSTANCE_ID = "33333333-3333-4333-8333-333333333333";
const inProcess = (organizationId: string | null) =>
  ({ user: null, organizationId, req: undefined, res: undefined }) as unknown as Context;
const overHttp = {
  user: null,
  organizationId: "org-a",
  req: { headers: {} },
  res: {},
} as unknown as Context;

describe.each([
  ["atlassian", confluenceRouter],
  ["notion", notionRouter],
] as const)("%s importer router", (_name, pluginRouter) => {
  beforeEach(() => {
    mockFindByIdAndOrganization.mockReset();
    mockFindByIdAndOrganization.mockResolvedValue(null);
  });

  it("looks the instance up within the calling organization", async () => {
    await expect(
      pluginRouter.createCaller(inProcess("org-b")).listRoots({ instanceId: INSTANCE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockFindByIdAndOrganization).toHaveBeenCalledWith(INSTANCE_ID, "org-b");
  });

  it("refuses a context with an HTTP request or without an organization", async () => {
    for (const ctx of [overHttp, inProcess(null)]) {
      await expect(
        pluginRouter.createCaller(ctx).listRoots({ instanceId: INSTANCE_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mockFindByIdAndOrganization).not.toHaveBeenCalled();
  });
});

describe("HTTP router", () => {
  it("does not include registered plugin routers", () => {
    pluginRouterRegistry.registerRouter(
      "fake-plugin",
      t.router({ ping: t.procedure.input(z.void()).query(() => "pong") }),
    );
    expect(pluginRouterRegistry.getRouter("fake-plugin")).toBeDefined();

    const paths = Object.keys(
      (v1Router as unknown as { _def: { procedures: object } })._def.procedures,
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.startsWith("fake-plugin."))).toEqual([]);
    expect(paths.filter((p) => /^(confluence|notion|hay-plugin-|atlassian)/.test(p))).toEqual([]);

    pluginRouterRegistry.unregisterRouter("fake-plugin");
  });
});

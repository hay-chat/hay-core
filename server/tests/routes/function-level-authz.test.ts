import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { TRPCError } from "@trpc/server";

/** Sensitive procedures are gated by scope, bounded, and rate limited where they spend. */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: jest.fn(), log: jest.fn() },
}));

let rateLimited = false;
jest.mock("@server/trpc/middleware/rate-limit", () => ({
  RateLimits: { MODERATE: {}, STRICT: {} },
  rateLimitMiddleware:
    () =>
    ({ next }: { next: () => unknown }) => {
      if (rateLimited) throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      return next();
    },
  rateLimitedProcedure: jest.fn(),
}));

import { v1Router } from "@server/routes/v1";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { CustomerRepository } from "@server/repositories/customer.repository";
import { getDefaultScopesForRole, hasRequiredScope } from "@server/types/scopes";

type Procedure = (input?: unknown) => Promise<unknown>;

function callerFor(user: object) {
  return v1Router.createCaller({
    user: { id: "user-1", userOrganization: { organization: {} }, ...user },
    organizationId: "org-1",
    req: { headers: {} },
  } as never);
}

function jwt(role: "admin" | "member" | "contributor" | "viewer" | "agent") {
  const scopes = getDefaultScopesForRole(role);
  return callerFor({
    authMethod: "jwt",
    hasScope: (resource: string, action: string) => hasRequiredScope(resource, action, scopes),
    getRole: () => role,
  });
}

const apiKey = () => callerFor({ authMethod: "apikey", hasScope: () => true, getRole: () => "admin" });

function procedure(caller: unknown, path: string): Procedure {
  return path
    .split(".")
    .reduce((node, key) => (node as Record<string, unknown>)[key], caller) as Procedure;
}

const call = (caller: unknown, path: string, input?: unknown) =>
  procedure(caller, path)(input);

const conversationId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rateLimited = false;
  jest.restoreAllMocks();
});

describe("viewer is refused", () => {
  it.each([
    "customerPrivacy.requestExport",
    "customerPrivacy.requestDeletion",
    "customerPrivacy.getStatus",
    "customerPrivacy.listRequests",
    "plugins.getUITemplate",
    "plugins.testConnection",
    "plugins.callUiRoute",
    "conversations.addSecrets",
    "conversations.addContext",
    "conversations.export",
    "customers.addContext",
    "documents.regenerateEmbeddings",
    "docsAudit.analyze",
    "evidencePacks.generate",
  ])("%s", async (path) => {
    await expect(call(jwt("viewer"), path, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("customer privacy requests", () => {
  it.each(["member", "contributor", "agent"] as const)("are refused for %s", async (role) => {
    await expect(call(jwt(role), "customerPrivacy.listRequests", {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("source catalog changes", () => {
  it.each(["sources.register", "sources.activate", "sources.deactivate"])(
    "%s is refused without the internal secret, even for an admin",
    async (path) => {
      await expect(call(jwt("admin"), path, {})).rejects.toBeInstanceOf(TRPCError);
      await expect(call(jwt("admin"), path, {})).rejects.toMatchObject({
        code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/),
      });
    },
  );

  it.each(["member", "contributor"] as const)("%s keeps read access only", (role) => {
    const scopes = getDefaultScopesForRole(role);
    expect(hasRequiredScope("sources", "read", scopes)).toBe(true);
    expect(hasRequiredScope("sources", "create", scopes)).toBe(false);
    expect(hasRequiredScope("sources", "update", scopes)).toBe(false);
  });
});

describe("addSecrets and addContext", () => {
  const paths: Array<[string, object]> = [
    ["conversations.addContext", { id: conversationId, context: { _internal: true } }],
    ["customers.addContext", { externalId: "ext-1", context: { _mergedExternalIds: [] } }],
  ];

  it.each(paths)("%s refuses a dashboard member", async (path, input) => {
    await expect(call(jwt("member"), path, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(paths)("%s refuses reserved keys from an API key", async (path, input) => {
    await expect(call(apiKey(), path, input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses an oversized conversation context", async () => {
    const input = { id: conversationId, context: { blob: "x".repeat(70 * 1024) } };
    await expect(call(apiKey(), "conversations.addContext", input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses a conversation context that grows past the limit when merged", async () => {
    jest.spyOn(ConversationRepository.prototype, "findByIdAndOrganization").mockResolvedValue({
      organization_id: "org-1",
      context: { existing: "x".repeat(60 * 1024) },
    } as never);
    const update = jest.spyOn(ConversationRepository.prototype, "updateById").mockResolvedValue(null as never);
    const input = { id: conversationId, context: { more: "y".repeat(10 * 1024) } };
    await expect(call(apiKey(), "conversations.addContext", input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("merges a valid customer context for an API key", async () => {
    jest.spyOn(CustomerRepository.prototype, "findByExternalId").mockResolvedValue({
      id: "customer-1",
      external_metadata: { plan: "pro" },
    } as never);
    const update = jest.spyOn(CustomerRepository.prototype, "update").mockResolvedValue(null as never);
    await call(apiKey(), "customers.addContext", { externalId: "ext-1", context: { vip: true } });
    expect(update).toHaveBeenCalledWith("customer-1", "org-1", {
      external_metadata: { plan: "pro", vip: true },
    });
  });

  it("limits the number of secrets", async () => {
    const secrets = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, "v"]));
    await expect(
      call(apiKey(), "conversations.addSecrets", { id: conversationId, secrets }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("regenerateEmbeddings bounds", () => {
  it.each([
    [{ chunkSize: 99 }],
    [{ chunkSize: 4001 }],
    [{ chunkSize: 500.5 }],
    [{ chunkSize: 500, chunkOverlap: 500 }],
  ])("refuses %j", async (input) => {
    await expect(
      call(jwt("admin"), "documents.regenerateEmbeddings", input),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("spend limits", () => {
  it.each([
    "docsAudit.analyze",
    "documents.regenerateEmbeddings",
    "documents.suggestEdits",
    "playbooks.suggestEdits",
    "playbooks.generateInstructions",
    "embeddings.add",
    "setup.generatePlaybooks",
    "replays.start",
    "replays.startForInsight",
    "simulations.start",
    "testCases.startRegression",
    "organizations.create",
  ])("%s is rate limited before any work happens", async (path) => {
    rateLimited = true;
    await expect(call(jwt("admin"), path, {})).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});

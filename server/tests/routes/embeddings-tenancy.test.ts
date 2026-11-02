import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * embeddings router: needs document permissions, only links chunks to the
 * caller's own documents, and bounds what one call may embed. Retrieval takes
 * the document from the row's document_id column, not from chunk metadata.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: jest.fn(async () => undefined) },
}));

const mockQuery = jest.fn<(sql: string, params: unknown[]) => Promise<unknown>>();
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { isInitialized: true, query: mockQuery },
}));

const mockEmbed = jest.fn(async ({ input }: { input: string | string[] }) => {
  const texts = Array.isArray(input) ? input : [input];
  return {
    embeddings: texts.map(() => new Array(1536).fill(0)),
    dimensions: 1536,
    usage: {},
    model: "m",
    provider: "p",
  };
});
jest.mock("@server/services/llm/llm-provider.factory", () => ({
  llmProviderFactory: {
    forOrganization: async () => ({ embedding: { embed: mockEmbed }, region: "us" }),
  },
}));
jest.mock("@server/services/llm/usage-sink", () => ({ emitUsage: () => undefined }));

const mockDocumentFind =
  jest.fn<(id: string, orgId: string) => Promise<Record<string, unknown> | null>>();
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: { findByIdAndOrganization: mockDocumentFind },
}));

import { embeddingsRouter } from "@server/routes/v1/embeddings";
import { vectorStoreService } from "@server/services/vector-store.service";
import { getDefaultScopesForRole, matchesScope } from "@server/types/scopes";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "44444444-4444-4444-8444-444444444444";

const callerAs = (role: "owner" | "member" | "viewer") => {
  const scopes = getDefaultScopesForRole(role);
  return embeddingsRouter.createCaller({
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      hasScope: (resource: string, action: string) => matchesScope(`${resource}:${action}`, scopes),
      getRole: () => role,
      userOrganization: { organization: {} },
    },
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context);
};

describe("embeddings router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([{ id: "e1" }]);
  });

  it("a viewer cannot add embeddings", async () => {
    await expect(callerAs("viewer").add({ content: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a document from another organization", async () => {
    mockDocumentFind.mockResolvedValue(null);
    await expect(
      callerAs("member").add({ content: "x", documentId: DOC_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDocumentFind).toHaveBeenCalledWith(DOC_ID, ORG_ID);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("links chunks to a document of the caller's organization", async () => {
    mockDocumentFind.mockResolvedValue({ id: DOC_ID });
    await callerAs("member").add({ content: "x", documentId: DOC_ID });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO embeddings"),
      expect.arrayContaining([ORG_ID, DOC_ID]),
    );
  });

  it("bounds the number of chunks", async () => {
    const chunks = Array.from({ length: 101 }, () => ({ content: "x" }));
    await expect(callerAs("member").add({ content: "x", chunks })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("vectorStoreService.search", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await vectorStoreService.initialize();
  });

  it("takes the document from the document_id column, not chunk metadata", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "e1",
        documentId: DOC_ID,
        content: "c",
        metadata: { documentId: "99999999-9999-4999-8999-999999999999" },
        similarity: 0.9,
      },
    ]);
    const [result] = await vectorStoreService.search(ORG_ID, "q", 5);
    expect(result.documentId).toBe(DOC_ID);
    expect(mockQuery.mock.calls[0][0]).toContain('"document_id" as "documentId"');
  });
});

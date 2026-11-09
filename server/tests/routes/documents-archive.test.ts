import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Archiving a document removes its embeddings (so the assistant stops quoting
 * it) and restoring it rebuilds them. Only real status transitions act.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

let existing: Record<string, unknown>;
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: {
    update: async (id: string, _org: string, data: Record<string, unknown>) => ({
      ...existing,
      id,
      ...data,
    }),
    findByIdAndOrganization: async () => existing,
  },
}));
const mockDelete = jest.fn(async () => 0);
const mockAdd = jest.fn(async () => ["e1"]);
jest.mock("@server/services/vector-store.service", () => ({
  vectorStoreService: {
    initialized: true,
    addChunks: () => mockAdd(),
    deleteByDocumentId: () => mockDelete(),
  },
}));

import { documentsRouter } from "@server/routes/v1/documents";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const caller = () =>
  documentsRouter.createCaller({
    user: { id: "user-1", hasScope: () => true, getRole: () => "owner" },
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context);

const stored = (status: string) => ({
  id: "doc-1",
  organizationId: ORG_ID,
  title: "Policy",
  content: "Returns within 30 days",
  type: "article",
  status,
});

describe("documents.update archive transitions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes embeddings when a document becomes archived", async () => {
    existing = stored("published");
    await caller().update({ id: "doc-1", status: "archived" as never });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("rebuilds embeddings when a document leaves archived", async () => {
    existing = stored("archived");
    await caller().update({ id: "doc-1", status: "published" as never });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an already archived document", async () => {
    existing = stored("archived");
    await caller().update({ id: "doc-1", status: "archived" as never });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

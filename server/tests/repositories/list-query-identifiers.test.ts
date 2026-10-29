import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * List queries interpolate client-named columns (select, search fields,
 * sorting, includes) into SQL; only plain identifiers may reach the query.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const sql: string[] = [];
const queryBuilder: Record<string, unknown> = {};
for (const method of [
  "where",
  "andWhere",
  "orderBy",
  "leftJoinAndSelect",
  "skip",
  "take",
  "select",
]) {
  queryBuilder[method] = (expression: unknown) => {
    sql.push(String(expression));
    return queryBuilder;
  };
}
queryBuilder.getCount = async () => 0;
queryBuilder.getMany = async () => [];

jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    isInitialized: true,
    getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
  },
}));

import { CustomerRepository } from "@server/repositories/customer.repository";
import { ConversationRepository } from "@server/repositories/conversation.repository";
import { DocumentRepository } from "@server/repositories/document.repository";
import type { ListParams } from "@server/trpc/middleware/pagination";
import { baseListInputSchema } from "@server/types/list-input";
import { conversationListInputSchema } from "@server/types/entity-list-inputs";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

const params = (overrides: Partial<ListParams>): ListParams => ({
  pagination: { page: 1, limit: 20, offset: 0 },
  sorting: { orderBy: "created_at", orderDirection: "desc" },
  ...overrides,
});

const repositories = [
  ["customers", () => new CustomerRepository()],
  ["conversations", () => new ConversationRepository()],
  ["documents", () => new DocumentRepository()],
] as const;

describe("list query identifiers", () => {
  beforeEach(() => {
    sql.length = 0;
  });

  describe.each(repositories)("%s repository", (_name, make) => {
    it("rejects a select field that is not an identifier", async () => {
      await expect(make().paginateQuery(params({ select: ["id; --"] }), ORG_ID)).rejects.toThrow(
        "Invalid select field",
      );
      expect(sql.join(" ")).not.toContain("; --");
    });

    it("rejects a search field that is not an identifier", async () => {
      await expect(
        make().paginateQuery(
          params({ search: { query: "x", searchFields: ["name) OR (1=1"] } }),
          ORG_ID,
        ),
      ).rejects.toThrow("Invalid search field");
    });

    it("rejects an include that is not an identifier", async () => {
      await expect(
        make().paginateQuery(params({ include: ['x" ON 1=1 --'] }), ORG_ID),
      ).rejects.toThrow("Invalid relation name");
    });

    it("rejects a sort column that is not an identifier", async () => {
      await expect(
        make().paginateQuery(
          params({ sorting: { orderBy: "created_at; DROP", orderDirection: "asc" } }),
          ORG_ID,
        ),
      ).rejects.toThrow("Invalid sort column");
    });

    it("selects plain identifiers", async () => {
      await make().paginateQuery(params({ select: ["id", "created_at"] }), ORG_ID);
      expect(sql).toContain("entity.id,entity.created_at");
    });
  });

  it("list input schemas refuse non-identifier field names", () => {
    for (const schema of [baseListInputSchema, conversationListInputSchema]) {
      expect(schema.safeParse({ select: ["id; --"] }).success).toBe(false);
      expect(schema.safeParse({ include: ["a b"] }).success).toBe(false);
      expect(schema.safeParse({ select: ["id", "title"] }).success).toBe(true);
    }
    expect(baseListInputSchema.safeParse({ sorting: { orderBy: "x;" } }).success).toBe(false);
    expect(
      baseListInputSchema.safeParse({ search: { query: "q", searchFields: ["a'"] } }).success,
    ).toBe(false);
  });
});

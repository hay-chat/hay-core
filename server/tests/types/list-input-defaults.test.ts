import { describe, it, expect } from "@jest/globals";
import { baseListInputSchema } from "@server/types/list-input";
import { documentListInputSchema } from "@server/types/entity-list-inputs";

/** Omitted pagination and sorting still come back with their nested defaults. */
describe("list input defaults", () => {
  it("fills pagination and sorting when the client sends neither", () => {
    expect(baseListInputSchema.parse({})).toMatchObject({
      pagination: { page: 1, limit: 20 },
      sorting: { orderDirection: "desc" },
    });
  });

  it("fills entity-specific sorting defaults", () => {
    expect(documentListInputSchema.parse({}).sorting).toEqual({
      orderBy: "created_at",
      orderDirection: "desc",
    });
  });

  it("keeps values the client sends", () => {
    expect(baseListInputSchema.parse({ pagination: { page: 3 } }).pagination).toEqual({
      page: 3,
      limit: 20,
    });
  });
});

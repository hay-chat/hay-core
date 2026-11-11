import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: { query: jest.fn() } }));

import { identifierTerms, keywordTerms } from "@server/services/product-keyword-search.service";

describe("keywordTerms", () => {
  it("splits a query into lower-case words of letters and digits", () => {
    expect(keywordTerms("Sony WH-1000XM5, please!")).toEqual(["sony", "wh", "1000xm5", "please"]);
  });

  it("keeps accented letters and drops single characters and repeats", () => {
    expect(keywordTerms("Camiseta básica M e camiseta")).toEqual(["camiseta", "básica"]);
  });

  it("leaves nothing that could change the meaning of a tsquery", () => {
    expect(keywordTerms("shirt & !blue | (red) :* 'x'")).toEqual(["shirt", "blue", "red"]);
  });

  it("caps the number of terms", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    expect(keywordTerms(long)).toHaveLength(16);
  });
});

describe("identifierTerms", () => {
  it("keeps SKU-like tokens whole and trims surrounding punctuation", () => {
    expect(identifierTerms("Do you have (TR2-BLK-42)?")).toEqual(["you", "have", "tr2-blk-42"]);
  });

  it("returns nothing for an empty query", () => {
    expect(identifierTerms("  ")).toEqual([]);
  });
});

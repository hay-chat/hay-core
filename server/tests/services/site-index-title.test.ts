import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/web-scraper.service", () => ({ WebScraperService: class {} }));

import { titleFromUrl } from "../../services/site-index.service";

describe("titleFromUrl", () => {
  it("turns the path into words", () => {
    expect(titleFromUrl("https://shop.com/products/blue-shirt.html")).toBe("products blue shirt");
    expect(titleFromUrl("https://shop.com/pages/frete_e_devolução")).toBe(
      "pages frete e devolução",
    );
  });

  it("calls the root home", () => {
    expect(titleFromUrl("https://shop.com/")).toBe("home");
  });
});

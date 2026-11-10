import { describe, it, expect } from "@jest/globals";
import { lastPathSegment, pickPageProduct } from "@server/services/page-product.service";

const shoe = {
  id: "p1",
  handle: "blue-shoe",
  sourceUrl: "https://shop.test/products/blue-shoe",
};

describe("pickPageProduct", () => {
  it("matches the product's own page whatever the tracking parameters", () => {
    const page = new URL("https://www.shop.test/products/blue-shoe/?utm_source=ad#reviews");
    expect(pickPageProduct(page, [shoe])).toBe(shoe);
  });

  it("matches the product under a collection or locale path", () => {
    const page = new URL("https://shop.test/en-gb/collections/sale/products/blue-shoe");
    expect(pickPageProduct(page, [shoe])).toBe(shoe);
  });

  it("does not match the same handle on another site", () => {
    const page = new URL("https://other.test/products/blue-shoe");
    expect(pickPageProduct(page, [shoe])).toBeNull();
  });

  it("prefers the exact page when two sources share a handle", () => {
    const twin = { id: "p2", handle: "blue-shoe", sourceUrl: "https://shop.test/loja/blue-shoe" };
    const page = new URL("https://shop.test/loja/blue-shoe");
    expect(pickPageProduct(page, [shoe, twin])).toBe(twin);
  });

  it("gives up when the page could be either product", () => {
    const twin = { id: "p2", handle: "blue-shoe", sourceUrl: "https://shop.test/loja/blue-shoe" };
    const page = new URL("https://shop.test/sale/blue-shoe");
    expect(pickPageProduct(page, [shoe, twin])).toBeNull();
  });
});

describe("lastPathSegment", () => {
  it("is empty on the home page", () => {
    expect(lastPathSegment(new URL("https://shop.test/"))).toBeNull();
  });

  it("decodes the segment", () => {
    expect(lastPathSegment(new URL("https://shop.test/produto/t%C3%AAnis-azul/"))).toBe(
      "tênis-azul",
    );
  });
});

import { describe, expect, it } from "vitest";
import { readableWebsite } from "./setup-website";

describe("readableWebsite", () => {
  it("accepts a whole address with or without a scheme and returns its origin", () => {
    expect(readableWebsite("alma.example")).toBe("https://alma.example");
    expect(readableWebsite(" http://shop.alma.example/returns?x=1 ")).toBe(
      "http://shop.alma.example",
    );
  });

  it("waits while the address is still being typed", () => {
    for (const partial of [
      "",
      "al",
      "alma.",
      "alma.e",
      "https://",
      "alma example",
      "ftp://a.com",
    ]) {
      expect(readableWebsite(partial)).toBeNull();
    }
  });
});

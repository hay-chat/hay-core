import { describe, it, expect } from "vitest";
import { safeHttpUrl } from "../markdown";

describe("safeHttpUrl", () => {
  it("keeps absolute http(s) URLs", () => {
    expect(safeHttpUrl("https://shop.example/p/1")).toBe("https://shop.example/p/1");
    expect(safeHttpUrl(" http://shop.example ")).toBe("http://shop.example/");
  });

  it("drops other schemes, relative URLs and non-strings", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl(" JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeUndefined();
    expect(safeHttpUrl("/relative")).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(42)).toBeUndefined();
  });
});

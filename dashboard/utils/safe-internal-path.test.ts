import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-internal-path";

describe("safeInternalPath", () => {
  it.each(["/", "/documents", "/accept-invitation?token=abc", "/a/b?x=1#y"])(
    "keeps the internal path %s",
    (path) => {
      expect(safeInternalPath(path)).toBe(path);
    },
  );

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/a/..//evil.example",
    "javascript:alert(1)",
    " //evil.example",
    "documents",
    "",
  ])("rejects %j", (value) => {
    expect(safeInternalPath(value)).toBe("/");
  });

  it("rejects non-strings, as repeated query params arrive as arrays", () => {
    expect(safeInternalPath(["/a", "/b"])).toBe("/");
    expect(safeInternalPath(undefined)).toBe("/");
  });

  it("uses the given fallback", () => {
    expect(safeInternalPath("//evil.example", "")).toBe("");
  });
});

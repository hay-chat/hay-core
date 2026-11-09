import { describe, it, expect } from "@jest/globals";
import { escapeLike } from "@server/lib/sql-like";

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLike("o'brien")).toBe("o'brien");
  });
});

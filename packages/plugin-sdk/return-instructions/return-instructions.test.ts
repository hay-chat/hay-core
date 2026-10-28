import { describe, it, expect } from "vitest";
import { readReturnInstructions, returnInstructionsResult, MAX_LENGTH } from "./index.cjs";

describe("return instructions", () => {
  it("is unset when empty or whitespace", () => {
    expect(readReturnInstructions({})).toBeNull();
    expect(readReturnInstructions({ RETURN_INSTRUCTIONS: "   " })).toBeNull();
    expect(returnInstructionsResult({})).toMatchObject({ configured: false, instructions: null });
  });

  it("returns the trimmed, length-capped text to relay", () => {
    const res = returnInstructionsResult({ RETURN_INSTRUCTIONS: "  Go to https://x.test/returns \n" });
    expect(res).toMatchObject({ configured: true, instructions: "Go to https://x.test/returns" });
    expect(readReturnInstructions({ RETURN_INSTRUCTIONS: "a".repeat(5000) })).toHaveLength(MAX_LENGTH);
  });
});

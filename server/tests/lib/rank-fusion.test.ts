import { describe, it, expect } from "@jest/globals";
import { reciprocalRankFusion } from "@server/lib/rank-fusion";

describe("reciprocalRankFusion", () => {
  it("puts an id both searches found ahead of ids only one found", () => {
    const vector = ["bose", "runner", "sony"];
    const keyword = ["sony"];
    expect(reciprocalRankFusion([vector, keyword])).toEqual(["sony", "bose", "runner"]);
  });

  it("keeps a single ranking's order", () => {
    expect(reciprocalRankFusion([["a", "b", "c"], []])).toEqual(["a", "b", "c"]);
  });

  it("includes ids only the second search found", () => {
    expect(reciprocalRankFusion([["a", "b"], ["z"]])).toEqual(["a", "z", "b"]);
  });

  it("breaks ties in favour of the first ranking", () => {
    expect(reciprocalRankFusion([["a"], ["b"]])).toEqual(["a", "b"]);
  });

  it("counts an id once per ranking, at its best position", () => {
    expect(reciprocalRankFusion([["a", "b", "a"], ["b"]])).toEqual(["b", "a"]);
  });

  it("returns nothing for no rankings", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { spamReasonKeys, spamSourceOf } from "./spam";

describe("spam reasons", () => {
  it("explains detector holds by their signals", () => {
    expect(spamReasonKeys("detector", ["links", "known_pattern"])).toEqual([
      "home.spam.signals.links",
      "home.spam.signals.known_pattern",
    ]);
  });

  it("falls back to who flagged it, ignoring unknown signals", () => {
    expect(spamReasonKeys("staff")).toEqual(["home.spam.sources.staff"]);
    expect(spamReasonKeys("detector", ["future_signal"])).toEqual(["home.spam.sources.detector"]);
    expect(spamReasonKeys("weird")).toEqual(["home.spam.sources.other"]);
  });

  it("reads the source from the stored spam reason", () => {
    expect(spamSourceOf("detector:links,repeated")).toBe("detector");
    expect(spamSourceOf("staff")).toBe("staff");
    expect(spamSourceOf("close_classifier")).toBe("close_classifier");
    expect(spamSourceOf("something")).toBe("other");
    expect(spamSourceOf(null)).toBe("other");
  });
});

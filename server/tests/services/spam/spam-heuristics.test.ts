import { describe, it, expect } from "@jest/globals";
import {
  scoreSpam,
  SPAM_THRESHOLD,
  SUSPICIOUS_THRESHOLD,
} from "@server/services/spam/spam-heuristics";

describe("scoreSpam", () => {
  it("leaves ordinary shopper questions alone, even with one product link", () => {
    for (const messages of [
      ["Hi, where is my order #1234?"],
      ["Do you have this in size M? https://shop.example.com/products/tee"],
      ["Oi, vocês entregam em Curitiba?"],
      ["ok", "thanks"],
    ]) {
      expect(scoreSpam({ messages }).score).toBeLessThan(SUSPICIOUS_THRESHOLD);
    }
  });

  it("holds link dumps and SEO pitches", () => {
    const pitch = scoreSpam({
      messages: [
        "We offer SEO and backlinks to rank your website: https://a.test https://b.test https://c.test",
      ],
    });
    expect(pitch.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
    expect(pitch.signals).toEqual(expect.arrayContaining(["links", "known_pattern"]));
  });

  it("holds the same message sent over and over", () => {
    const result = scoreSpam({
      messages: ["buy now https://x.test", "buy now https://x.test", "buy now https://x.test"],
    });
    expect(result.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
    expect(result.signals).toEqual(expect.arrayContaining(["repeated", "links"]));
  });

  it("treats a bare link as suspicious but not conclusive", () => {
    const result = scoreSpam({ messages: ["https://promo.test/deal"] });
    expect(result.signals).toEqual(["link_only"]);
    expect(result.score).toBeGreaterThanOrEqual(SUSPICIOUS_THRESHOLD);
    expect(result.score).toBeLessThan(SPAM_THRESHOLD);
  });

  it("tips a borderline chat when the bot check could not verify the visitor", () => {
    const plain = scoreSpam({ messages: ["https://promo.test/deal"] });
    const unverified = scoreSpam({
      messages: ["https://promo.test/deal"],
      botCheckDecision: "flag",
    });
    expect(unverified.score).toBeGreaterThan(plain.score);
    expect(unverified.signals).toContain("unverified");
    expect(scoreSpam({ messages: ["Hello"], botCheckDecision: "flag" }).score).toBeLessThan(
      SUSPICIOUS_THRESHOLD,
    );
  });

  it("flags walls of text and messages with no letters", () => {
    expect(scoreSpam({ messages: ["a ".repeat(1500)] }).signals).toContain("too_long");
    expect(scoreSpam({ messages: ["$$$ 123 !!!"] }).signals).toContain("no_text");
    expect(scoreSpam({ messages: ["🙂"] }).signals).toContain("no_text");
  });
});

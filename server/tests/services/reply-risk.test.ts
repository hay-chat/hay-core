import { describe, it, expect } from "@jest/globals";
import { hasFactualSpecifics, isWriteAdjacentReply } from "../../services/core/reply-risk";

describe("reply risk signals", () => {
  it.each([
    "Your order #1001 is on its way",
    "That will be €20",
    "See https://example.com/returns",
    "Visit example.shop for details",
  ])("flags specifics in %p", (reply) => {
    expect(hasFactualSpecifics(reply)).toBe(true);
    expect(isWriteAdjacentReply(reply)).toBe(true);
  });

  it.each(["I've cancelled it for you", "Seu reembolso foi feito", "Ya envié el paquete"])(
    "treats a claimed action as write-adjacent: %p",
    (reply) => {
      expect(isWriteAdjacentReply(reply)).toBe(true);
    },
  );

  it("lets a plain greeting through", () => {
    expect(hasFactualSpecifics("Hi! How can I help you today?")).toBe(false);
    expect(isWriteAdjacentReply("Hi! How can I help you today?")).toBe(false);
  });
});

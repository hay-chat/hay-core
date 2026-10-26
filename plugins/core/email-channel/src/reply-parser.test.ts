import { describe, expect, it } from "vitest";
import { extractReply } from "./reply-parser.js";

describe("extractReply", () => {
  it("drops a Gmail quoted block with a wrapped attribution line", () => {
    const text = [
      "Thanks, that worked!",
      "",
      "On Mon, 26 Oct 2026 at 10:12, Acme Support <support@updates.hay.test>",
      "wrote:",
      "",
      "> Hi Ana, your order shipped yesterday.",
      "> Tracking: 123",
    ].join("\n");
    expect(extractReply(text)).toBe("Thanks, that worked!");
  });

  it("drops Outlook header blocks and separators", () => {
    const text = [
      "Still nothing here.",
      "",
      "________________________________",
      "From: Acme Support <support@updates.hay.test>",
      "Sent: Monday, October 26, 2026 10:12",
      "To: Ana",
      "Subject: Re: Where is my order?",
      "Your order shipped.",
    ].join("\n");
    expect(extractReply(text)).toBe("Still nothing here.");
  });

  it("drops Portuguese attributions and signatures", () => {
    const text = [
      "Obrigada!",
      "",
      "Em seg., 26 de out. de 2026 às 10:12, Acme <support@acme.com> escreveu:",
      "> Olá Ana",
      "",
      "-- ",
      "Ana Shopper",
    ].join("\n");
    expect(extractReply(text)).toBe("Obrigada!");
  });

  it("keeps a message that merely starts with 'On'", () => {
    const text = "On second thought, please cancel the order.";
    expect(extractReply(text)).toBe(text);
  });

  it("returns the original text when stripping would leave nothing", () => {
    const text = "> only quoted\n> text";
    expect(extractReply(text)).toBe(text);
  });
});

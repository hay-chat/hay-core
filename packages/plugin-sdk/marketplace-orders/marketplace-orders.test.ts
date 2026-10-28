import { describe, it, expect } from "vitest";
import { detectMarketplace, orderNotFoundError } from "./index.cjs";

describe("marketplace order detection", () => {
  it.each([
    ["2000012345678901", "mercado_livre"],
    ["#2000012345678901", "mercado_livre"],
    ["701-1234567-1234567", "amazon"],
    ["240512AB12CD34", "shopee"],
    ["pedido do Mercado Livre", "mercado_livre"],
    ["Magazine Luiza 123", "magalu"],
    ["tiktok 55", "tiktok_shop"],
  ])("recognises %s", (ref, id) => {
    expect(detectMarketplace(ref)?.id).toBe(id);
  });

  it.each(["1001", "#1001", "12345678901234", "241399AB12CD34", "20001", ""])(
    "leaves store-looking references alone: %s",
    (ref) => {
      expect(detectMarketplace(ref)).toBeNull();
    },
  );

  it("routes a marketplace order and keeps the store's guidance as a fallback", () => {
    const err = orderNotFoundError("2000012345678901", "Ask for the store order number.");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toMatch(/Mercado Livre/);
    expect(err.message).toMatch(/Minhas compras/);
    expect(err.message).toMatch(/Ask for the store order number\./);
    expect(err.details).toEqual({ marketplace: "mercado_livre", matchedBy: "id_pattern" });
  });

  it("adds a short marketplace hint to an ordinary not-found", () => {
    const err = orderNotFoundError("1001", "Order 1001 not found.");
    expect(err.message).toMatch(
      /^Order 1001 not found\. If the customer bought it on a marketplace/,
    );
  });
});

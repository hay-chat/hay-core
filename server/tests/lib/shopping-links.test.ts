import { describe, it, expect } from "@jest/globals";
import { variantBuyUrl, withBuyUrl, withShoppingAttribution } from "@server/lib/shopping-links";

const CONVERSATION = "0b0f6a0e-1c1c-4c1c-8c1c-0123456789ab";

describe("withShoppingAttribution", () => {
  it("tags a store link with the source and the conversation", () => {
    const url = new URL(
      withShoppingAttribution("https://shop.test/products/blue-shoe", CONVERSATION) as string,
    );
    expect(url.origin + url.pathname).toBe("https://shop.test/products/blue-shoe");
    expect(url.searchParams.get("utm_source")).toBe("hay");
    expect(url.searchParams.get("utm_medium")).toBe("chat");
    expect(url.searchParams.get("utm_campaign")).toBe("product_recommendation");
    expect(url.searchParams.get("hay_conversation")).toBe(CONVERSATION);
  });

  it("keeps the link's own parameters", () => {
    const url = new URL(
      withShoppingAttribution("https://shop.test/?add-to-cart=10", CONVERSATION) as string,
    );
    expect(url.searchParams.get("add-to-cart")).toBe("10");
    expect(url.searchParams.get("utm_source")).toBe("hay");
  });

  it("gives no link for anything that is not http(s)", () => {
    expect(withShoppingAttribution("javascript:alert(1)", CONVERSATION)).toBeUndefined();
    expect(withShoppingAttribution("not a url", CONVERSATION)).toBeUndefined();
    expect(withShoppingAttribution(undefined, CONVERSATION)).toBeUndefined();
  });
});

describe("variant buy link", () => {
  it("is stored with the variant's other attributes and read back", () => {
    const stored = withBuyUrl({ material: "linen" }, "https://shop.test/cart/44:1");
    expect(stored).toEqual({ material: "linen", buyUrl: "https://shop.test/cart/44:1" });
    expect(variantBuyUrl(stored)).toBe("https://shop.test/cart/44:1");
  });

  it("only comes from the canonical field, never from adapter attributes", () => {
    expect(withBuyUrl({ buyUrl: "https://evil.test/", material: "linen" }, undefined)).toEqual({
      material: "linen",
    });
  });

  it("drops a link that is not http(s)", () => {
    expect(withBuyUrl(undefined, "javascript:alert(1)")).toBeUndefined();
    expect(variantBuyUrl({ buyUrl: "javascript:alert(1)" })).toBeUndefined();
  });
});

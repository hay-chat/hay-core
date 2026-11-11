import { describe, expect, it, vi } from "vitest";
import plugin from "../index.js";
import { CART_REQUESTS, cartItemId } from "../cart.js";

const STORE_URL = "https://shop.example.com/products/blue-shoe";
const VARIANT = "gid://shopify/ProductVariant/36110175633573";

describe("cartItemId", () => {
  it("is the variant's numeric id", () => {
    expect(cartItemId(STORE_URL, { id: VARIANT, availableForSale: true })).toBe("36110175633573");
    expect(cartItemId(STORE_URL, { id: VARIANT })).toBe("36110175633573");
  });

  it("is absent for a variant that is not available for sale", () => {
    expect(cartItemId(STORE_URL, { id: VARIANT, availableForSale: false })).toBeUndefined();
  });

  it("is absent for a product that is not on the online store", () => {
    expect(cartItemId(null, { id: VARIANT, availableForSale: true })).toBeUndefined();
  });

  it("is absent for an id that is not a variant", () => {
    expect(cartItemId(STORE_URL, { id: "gid://shopify/Product/1::default" })).toBeUndefined();
  });
});

describe("cart@1 contribution", () => {
  const silent = { info() {}, warn() {}, error() {}, debug() {} };

  /** Run onInitialize with a register API that accepts everything and records calls. */
  async function initialize() {
    const contribution = vi.fn();
    const config = vi.fn();
    const anything: unknown = new Proxy(() => undefined, { get: () => anything });
    const definition = plugin({ logger: silent } as never);
    await definition.onInitialize!({
      register: new Proxy(
        { config, webchat: { contribution } },
        { get: (target, key) => (key in target ? target[key as keyof typeof target] : anything) },
      ),
      config: { field: (name: string) => ({ name }) },
      logger: silent,
    } as never);
    return { contribution, config };
  }

  it("describes the Ajax Cart API, switched by the cartActions field", async () => {
    const { contribution, config } = await initialize();
    expect(contribution).toHaveBeenCalledWith({
      id: "cart",
      type: "cart@1",
      props: {
        enabled: { name: "cartActions" },
        addPath: "/cart/add.js",
        addBody: CART_REQUESTS.addBody,
        checkoutPath: "/checkout",
      },
    });
    expect(config.mock.calls[0][0].cartActions).toMatchObject({ type: "boolean", default: true });
  });

  it("fills to the add.js body, with the variant id as a number", () => {
    const body = CART_REQUESTS.addBody
      .replace("{{cartItemId}}", "36110175633573")
      .replace("{{quantity}}", "1")
      .replace("{{conversationId}}", "0b1f6c1e-8a50-4a7e-9f0c-2f4a1f0e9d11");
    expect(JSON.parse(body)).toEqual({
      items: [
        {
          id: 36110175633573,
          quantity: 1,
          properties: { _hay_conversation: "0b1f6c1e-8a50-4a7e-9f0c-2f4a1f0e9d11" },
        },
      ],
    });
  });

  it("declares the webchat capability the contribution needs", async () => {
    const manifest = (await import("../../package.json", { with: { type: "json" } })).default;
    expect(manifest["hay-plugin"].capabilities).toContain("webchat");
  });
});

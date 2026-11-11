import { describe, it, expect } from "vitest";
import {
  CART_ADD_BODY,
  CART_AFTER_ADD_EVENTS,
  CART_DEFAULTS,
  cartConfigFields,
  cartContribution,
} from "./cart";

// The checks Core applies to `cart@1` props (cartV1Schema in
// server/services/webchat/webchat-extensions.service.ts), restated here because
// a plugin cannot import Core.
const SAME_ORIGIN_PATH = /^\/(?!\/)[^\s\\]{0,500}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const EVENT_NAME = /^[A-Za-z0-9_:.-]{1,64}$/;

const contribution = cartContribution((name) => ({ name }));

/** Props as Core resolves them for an org that changed nothing. */
function resolvedDefaults(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(contribution.props).map(([prop, value]) => [
      prop,
      typeof value === "object" ? cartConfigFields[value.name]?.default : value,
    ]),
  );
}

describe("cart@1 contribution", () => {
  it("takes the switch and every per-store path from public config fields", () => {
    expect(contribution).toMatchObject({ id: "cart", type: "cart@1" });
    expect(contribution.props).toMatchObject({
      enabled: { name: "cartActions" },
      addPath: { name: "cartAddPath" },
      tokenPath: { name: "cartTokenPath" },
      checkoutPath: { name: "checkoutPath" },
    });
    for (const value of Object.values(contribution.props)) {
      if (typeof value !== "object") continue;
      // Core never resolves an encrypted field into public props.
      expect(cartConfigFields[value.name]).toBeDefined();
      expect(cartConfigFields[value.name].encrypted).toBeFalsy();
    }
  });

  it("is on by default", () => {
    expect(cartConfigFields.cartActions).toMatchObject({ type: "boolean", default: true });
  });

  it("resolves by default to the Store API add-item call with its nonce", () => {
    const props = resolvedDefaults();
    expect(props).toEqual({
      enabled: true,
      addPath: "/wp-json/wc/store/v1/cart/add-item",
      addBody: CART_ADD_BODY,
      checkoutPath: "/checkout/",
      tokenPath: "/wp-json/wc/store/v1/cart",
      tokenResponseHeader: "Nonce",
      tokenRequestHeader: "Nonce",
      afterAddEvents: CART_AFTER_ADD_EVENTS,
    });
    for (const path of Object.values(CART_DEFAULTS)) expect(path).toMatch(SAME_ORIGIN_PATH);
    expect(props.tokenResponseHeader).toMatch(HEADER_NAME);
    expect(props.tokenRequestHeader).toMatch(HEADER_NAME);
  });

  it("documents folder and plain-permalink paths that Core accepts", () => {
    expect("/shop/wp-json/wc/store/v1/cart/add-item").toMatch(SAME_ORIGIN_PATH);
    expect("/?rest_route=/wc/store/v1/cart/add-item").toMatch(SAME_ORIGIN_PATH);
  });

  it("fills the body to the JSON the Store API expects, with a numeric id", () => {
    const body = CART_ADD_BODY.replace("{{cartItemId}}", "22").replace("{{quantity}}", "1");
    expect(JSON.parse(body)).toEqual({ id: 22, quantity: 1 });
  });

  it("refreshes the page's cart: classic fragments, the blocks' store and the Mini-Cart", () => {
    const events = JSON.parse(CART_AFTER_ADD_EVENTS);
    expect(events).toEqual([
      { name: "wc_fragment_refresh" },
      { name: "wc-blocks_added_to_cart" },
      {
        name: "wc-blocks_store_sync_required",
        target: "window",
        detail: { type: "from_@wordpress/data" },
      },
    ]);
    expect(events.length).toBeLessThanOrEqual(8);
    for (const event of events) expect(event.name).toMatch(EVENT_NAME);
  });
});

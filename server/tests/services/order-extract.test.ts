/**
 * D2-4: finding the orders a tool call or a message names, and grouping links.
 */
import { describe, it, expect } from "@jest/globals";
import {
  normalizeOrderToken,
  ordersFromText,
  ordersFromToolInput,
  ordersFromToolOutput,
} from "../../services/order-links/order-extract";
import { groupLinks } from "../../services/order-links/order-link.service";

const mcp = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("normalizeOrderToken", () => {
  it("strips # and gid prefixes and needs a digit", () => {
    expect(normalizeOrderToken("#1001")).toBe("1001");
    expect(normalizeOrderToken("gid://shop/Order/5566")).toBe("5566");
    expect(normalizeOrderToken(42)).toBe("42");
    expect(normalizeOrderToken(" AB-77 ")).toBe("ab-77");
    expect(normalizeOrderToken("hello")).toBeNull();
    expect(normalizeOrderToken("a b 1")).toBeNull();
  });
});

describe("ordersFromToolInput", () => {
  it("reads order id and number arguments", () => {
    expect(
      ordersFromToolInput("create_refund", { order_id: "gid://x/Order/9", amount: 5 }),
    ).toEqual([{ key: "9", label: null, source: "tool_input" }]);
    expect(ordersFromToolInput("lookup", { increment_id: "000123" })).toEqual([
      { key: "000123", label: "000123", source: "tool_input" },
    ]);
  });

  it("reads an order tool's own name argument, not other tools'", () => {
    expect(ordersFromToolInput("get_order_by_name", { name: "#1001" })).toEqual([
      { key: "1001", label: "1001", source: "tool_input" },
    ]);
    expect(ordersFromToolInput("get_product", { id: "123" })).toEqual([]);
  });
});

describe("ordersFromToolOutput", () => {
  it("reads an order tool's answer: platform id plus order number", () => {
    expect(
      ordersFromToolOutput(
        "get_order",
        mcp({ id: "gid://x/Order/5566", name: "#1001", lineItems: [{ id: "gid://x/LineItem/1" }] }),
      ),
    ).toEqual([{ key: "5566", label: "1001", source: "tool_output" }]);
  });

  it("reads an `order` object or order_id inside another tool's answer", () => {
    expect(
      ordersFromToolOutput("create_refund", mcp({ id: 7, order: { id: 55, number: 1001 } })),
    ).toEqual([{ key: "55", label: "1001", source: "tool_output" }]);
    expect(ordersFromToolOutput("create_return", { order_id: 55, status: "ok" })).toEqual([
      { key: "55", label: null, source: "tool_output" },
    ]);
  });

  it("links nothing from a long list of orders", () => {
    const orders = [1, 2, 3, 4].map((n) => ({ id: n, number: 1000 + n }));
    expect(ordersFromToolOutput("list_customer_orders", mcp({ orders }))).toEqual([]);
    expect(
      ordersFromToolOutput("list_customer_orders", mcp({ orders: orders.slice(0, 2) })),
    ).toHaveLength(2);
  });
});

describe("ordersFromText", () => {
  it("finds #1234 and order/pedido/encomenda numbers only", () => {
    expect(ordersFromText("Where is my order #1001?").map((r) => r.key)).toEqual(["1001"]);
    expect(ordersFromText("Meu pedido nº 2002 não chegou").map((r) => r.key)).toEqual(["2002"]);
    expect(ordersFromText("encomenda 3003").map((r) => r.key)).toEqual(["3003"]);
    expect(ordersFromText("Order number 4004").map((r) => r.key)).toEqual(["4004"]);
    expect(ordersFromText("call me on 912345678 at 10")).toEqual([]);
    expect(ordersFromText("I paid 1001 euros")).toEqual([]);
  });
});

describe("groupLinks", () => {
  const at = (n: number) => new Date(2026, 9, n);
  it("merges id-only, number-only and text links for the same order", () => {
    const groups = groupLinks([
      {
        plugin_id: "core/shop",
        order_key: "5566",
        order_label: null,
        conversation_id: "c1",
        created_at: at(1),
      },
      {
        plugin_id: "core/shop",
        order_key: "5566",
        order_label: "1001",
        conversation_id: "c2",
        created_at: at(2),
      },
      {
        plugin_id: "core/shop",
        order_key: "1001",
        order_label: "1001",
        conversation_id: "c3",
        created_at: at(3),
      },
      {
        plugin_id: null,
        order_key: "1001",
        order_label: "1001",
        conversation_id: "c4",
        created_at: at(4),
      },
      {
        plugin_id: null,
        order_key: "9999",
        order_label: "9999",
        conversation_id: "c5",
        created_at: at(5),
      },
    ]);
    expect(groups).toHaveLength(2);
    const shop = groups.find((g) => g.pluginId === "core/shop")!;
    expect(shop.orderKey).toBe("5566");
    expect(shop.orderLabel).toBe("1001");
    expect(shop.conversationIds.sort()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(groups.find((g) => g.pluginId === null)!.conversationIds).toEqual(["c5"]);
  });
});

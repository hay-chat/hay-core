import { pickHealthCheckTool } from "@server/lib/plugin-health-tool";

describe("pickHealthCheckTool", () => {
  it("prefers a dedicated health tool", () => {
    const tools = [{ name: "list_orders" }, { name: "healthcheck" }];
    expect(pickHealthCheckTool(tools)?.name).toBe("healthcheck");
  });

  it("uses a read-only tool without required parameters", () => {
    const tools = [
      { name: "get_order", inputSchema: { required: ["id"] } },
      { name: "list_products", inputSchema: { required: [] } },
    ];
    expect(pickHealthCheckTool(tools)?.name).toBe("list_products");
  });

  it("never picks a write tool, even one without required parameters", () => {
    const tools = [{ name: "send-email" }, { name: "cancel_order", inputSchema: {} }];
    expect(pickHealthCheckTool(tools)).toBeUndefined();
  });

  it("reads snake_case input_schema when deciding required parameters", () => {
    const tools = [{ name: "list_inboxes", input_schema: { required: ["account"] } }];
    expect(pickHealthCheckTool(tools)).toBeUndefined();
  });
});

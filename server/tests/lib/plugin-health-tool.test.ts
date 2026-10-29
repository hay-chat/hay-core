import { hasPluginCredentials, pickHealthCheckTool } from "@server/lib/plugin-health-tool";

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

describe("hasPluginCredentials", () => {
  it("accepts OAuth tokens in authState when config is empty", () => {
    expect(
      hasPluginCredentials({ config: {}, authState: { credentials: { accessToken: "tok" } } }),
    ).toBe(true);
  });

  it("accepts credentials in config", () => {
    expect(hasPluginCredentials({ config: { apiKey: "k" } })).toBe(true);
  });

  it("rejects empty config and empty authState", () => {
    expect(hasPluginCredentials({ config: { apiKey: "" }, authState: { credentials: {} } })).toBe(
      false,
    );
    expect(hasPluginCredentials({})).toBe(false);
  });
});

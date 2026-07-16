// The service imports the plugin-instance repository (which drags in the full
// TypeORM data source); getCachedToolDescriptors is a pure function, so stub it.
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));

import { getCachedToolDescriptors } from "../../services/plugin-tools.service";

describe("getCachedToolDescriptors", () => {
  const schema = {
    type: "object",
    properties: { order_id: { type: "string" } },
    required: ["order_id"],
  };

  it("reads MCP-spec camelCase inputSchema (what workers return and the cache stores)", () => {
    const config = {
      mcpServers: {
        local: [
          {
            serverId: "shopify",
            tools: [
              { name: "shopify_get_order", description: "Get an order", inputSchema: schema },
            ],
          },
        ],
      },
    };

    const descriptors = getCachedToolDescriptors(config);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].input_schema).toEqual(schema);
  });

  it("falls back to legacy snake_case input_schema for older cached entries", () => {
    const config = {
      mcpServers: {
        local: [
          {
            serverId: "legacy",
            tools: [{ name: "old_tool", description: "Legacy", input_schema: schema }],
          },
        ],
      },
    };

    const descriptors = getCachedToolDescriptors(config);
    expect(descriptors[0].input_schema).toEqual(schema);
  });

  it("returns empty for missing config", () => {
    expect(getCachedToolDescriptors(null)).toEqual([]);
    expect(getCachedToolDescriptors({})).toEqual([]);
  });
});

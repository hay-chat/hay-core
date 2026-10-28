// The service imports the plugin-instance repository (which drags in the full
// TypeORM data source); getCachedToolDescriptors is a pure function, so stub it.
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));

import { getCachedToolDescriptors } from "../../services/plugin-tools.service";
import { decideGate } from "../../services/core/action-policy";
// The same helper the plugin worker uses to merge a plugin's `toolRisk`
// declaration into tools/list before core caches it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withToolRisk } = require("@hay/plugin-sdk/tool-risk");

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

  it("exposes the risk class from cached annotations, defaulting to a write", () => {
    const config = {
      mcpServers: {
        local: [
          {
            serverId: "store",
            tools: [
              {
                name: "get_order",
                description: "Read",
                inputSchema: schema,
                annotations: { readOnlyHint: true },
              },
              {
                name: "create_refund",
                description: "Refund",
                inputSchema: schema,
                annotations: { readOnlyHint: false, destructiveHint: true },
                _meta: { "chat.hay/category": "refund" },
              },
              { name: "mystery", description: "Unannotated", inputSchema: schema },
            ],
          },
        ],
      },
    };

    const [read, refund, mystery] = getCachedToolDescriptors(config);
    expect(read.risk).toEqual({ readOnly: true, category: null, classified: true });
    expect(refund.risk).toEqual({ readOnly: false, category: "refund", classified: true });
    expect(mystery.risk).toEqual({ readOnly: false, category: "other_write", classified: false });
  });

  it("classifies tools from a plugin's toolRisk declaration and a hosted server's own hints", () => {
    // What a worker returns for a hosted MCP server registered with
    // toolRisk: { read: ["list_customers"], write: { create_refund: "refund", send_email: "other_write" } }
    const listed = withToolRisk(
      [
        { name: "list_customers", description: "Read" },
        { name: "create_refund", description: "Refund", annotations: { readOnlyHint: true } },
        { name: "send_email", description: "Email" },
        { name: "search_docs", description: "Hosted read", annotations: { readOnlyHint: true } },
        { name: "new_remote_tool", description: "Unknown" },
      ],
      {
        read: ["list_customers"],
        write: { create_refund: "refund", send_email: "other_write" },
      },
    );
    const config = { mcpServers: { local: [{ serverId: "remote", tools: listed }] } };

    const [read, refund, email, hostedRead, unknown] = getCachedToolDescriptors(config);
    expect(read.risk).toEqual({ readOnly: true, category: null, classified: true });
    expect(refund.risk).toEqual({ readOnly: false, category: "refund", classified: true });
    expect(email.risk).toEqual({ readOnly: false, category: "other_write", classified: true });
    expect(hostedRead.risk).toEqual({ readOnly: true, category: null, classified: true });
    expect(unknown.risk).toEqual({ readOnly: false, category: "other_write", classified: false });

    const gate = { moneyMovesNeedApproval: true, thresholdAmount: 0 };
    expect(decideGate(read.risk, {}, gate)).toEqual({ kind: "allow" });
    expect(decideGate(email.risk, {}, gate)).toEqual({ kind: "allow" });
    expect(decideGate(refund.risk, { amount: 10 }, gate)).toMatchObject({
      kind: "hold",
      reason: "money_move",
    });
    expect(decideGate(unknown.risk, {}, gate)).toMatchObject({
      kind: "hold",
      reason: "unclassified_write",
    });
  });

  it("returns empty for missing config", () => {
    expect(getCachedToolDescriptors(null)).toEqual([]);
    expect(getCachedToolDescriptors({})).toEqual([]);
  });
});

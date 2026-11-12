import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * agent_activity (C3): the widget hears when the AI starts and ends a tool,
 * with the labels from the tool's definition or the generic ones.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockPublish = jest.fn<(conversation: unknown, event: unknown) => Promise<void>>(
  async () => undefined,
);
jest.mock("@server/services/widget-events.service", () => ({
  publishWidgetEvent: (conversation: unknown, event: unknown) => mockPublish(conversation, event),
}));
jest.mock("@server/services/webchat/page-tools.service", () => ({
  isPageTool: (name: string) => name.startsWith("page:"),
}));
const mockGetTools = jest.fn<(organizationId: string) => Promise<unknown[]>>();
jest.mock("@server/services/mcp-registry.service", () => ({
  mcpRegistryService: { getToolsForOrg: (organizationId: string) => mockGetTools(organizationId) },
}));

import { runToolWithActivity, toolLabels } from "@server/orchestrator/tool-activity";

const web = { id: "conv-1", organization_id: "org-1", channel: "web" };

const events = () => mockPublish.mock.calls.map(([, event]) => event);

describe("runToolWithActivity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTools.mockResolvedValue([
      {
        pluginId: "shop",
        name: "get_order",
        label: "Looking up your order",
        doneLabel: "Checked your order",
      },
      { pluginId: "shop", name: "list_products" },
    ]);
  });

  it("announces start and end with the tool's own labels", async () => {
    const result = await runToolWithActivity(web, { name: "shop:get_order" }, async () => "ok");

    expect(result).toBe("ok");
    expect(events()).toEqual([
      {
        type: "agent_activity",
        state: "start",
        toolName: "shop:get_order",
        label: "Looking up your order",
        doneLabel: "Checked your order",
      },
      {
        type: "agent_activity",
        state: "end",
        toolName: "shop:get_order",
        label: "Looking up your order",
        doneLabel: "Checked your order",
      },
    ]);
  });

  it("ends the activity even when the tool throws", async () => {
    await expect(
      runToolWithActivity(web, { name: "shop:get_order" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(events().map((e) => (e as { state: string }).state)).toEqual(["start", "end"]);
  });

  it("leaves page tools to their on-page overlay, and non-web channels alone", async () => {
    await runToolWithActivity(web, { name: "page:add_to_cart" }, async () => "ok");
    await runToolWithActivity(
      { ...web, channel: "whatsapp" },
      { name: "shop:get_order" },
      async () => "ok",
    );
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("toolLabels", () => {
  beforeEach(() => jest.clearAllMocks());

  it("falls back to the generic labels", async () => {
    mockGetTools.mockResolvedValue([{ pluginId: "shop", name: "list_products" }]);
    const generic = { label: "Working on it…", doneLabel: "Done" };

    expect(await toolLabels("org-1", "shop:list_products")).toEqual(generic);
    expect(await toolLabels("org-1", "recommend_products")).toEqual(generic);
    mockGetTools.mockRejectedValue(new Error("db down"));
    expect(await toolLabels("org-1", "shop:get_order")).toEqual(generic);
  });
});

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SetupSettings } from "@server/types/setup.types";

const state = { setup: null as unknown as SetupSettings };
const playbookApi = {
  createPlaybook: jest.fn<(org: string, data: any) => Promise<{ id: string }>>(),
  updatePlaybook: jest.fn<(...args: any[]) => Promise<unknown>>(),
  deletePlaybook: jest.fn<(...args: any[]) => Promise<boolean>>(),
  getPlaybook: jest.fn<(...args: any[]) => Promise<any>>(),
  publishDraft: jest.fn<(...args: any[]) => Promise<unknown>>(),
};
const registry = { getToolsForOrg: jest.fn<(org: string) => Promise<any[]>>() };

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/playbook.service", () => ({
  PlaybookService: class {
    createPlaybook = playbookApi.createPlaybook;
    updatePlaybook = playbookApi.updatePlaybook;
    deletePlaybook = playbookApi.deletePlaybook;
    getPlaybook = playbookApi.getPlaybook;
    publishDraft = playbookApi.publishDraft;
  },
}));
jest.mock("@server/services/mcp-registry.service", () => ({ mcpRegistryService: registry }));
jest.mock("@server/services/organization.service", () => ({
  organizationService: { findOne: async () => ({ defaultLanguage: "pt-BR" }) },
}));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("../../services/setup/store", () => ({
  readSetup: async () => structuredClone(state.setup),
  updateSetup: async (_org: string, change: (s: SetupSettings) => SetupSettings) => {
    state.setup = change(structuredClone(state.setup));
    return state.setup;
  },
}));

import {
  generatePlaybooksFor,
  questionsToGenerate,
  turnOnPlaybook,
} from "../../services/setup/playbooks";
import type { BoardPlugin } from "../../services/setup/board";

const shop: BoardPlugin = {
  id: "shop",
  name: "Shop",
  handles: ["orders", "refunds"],
  businessTypes: ["store"],
  connected: true,
};
const forNeed = (need: string) => (shop.handles.includes(need as never) ? shop : undefined);
const orgTools = [
  {
    pluginId: "shop",
    name: "shop_get_order",
    description: "Fetch an order",
    risk: { readOnly: true, category: null, classified: true },
  },
];
const plan = {
  kind: "plan" as const,
  plan: {
    title: "Order status",
    trigger: "Customer asks about an order.",
    steps: [{ text: "Look it up.", tool: "shop:shop_get_order" }],
  },
  tools: [
    {
      id: "shop:shop_get_order",
      pluginId: "shop",
      name: "shop_get_order",
      description: "",
      readOnly: true,
      category: null,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  state.setup = {
    toolPluginIds: ["shop"],
    channels: [],
    questions: [{ id: "q1", text: "Where is my order?", source: "catalog", needs: "orders" }],
  };
  registry.getToolsForOrg.mockResolvedValue(orgTools);
  playbookApi.createPlaybook.mockResolvedValue({ id: "pb1" });
});

describe("questionsToGenerate", () => {
  const questions = [
    { id: "a", text: "a", source: "catalog" as const, needs: "orders" as const },
    { id: "b", text: "b", source: "catalog" as const, needs: "orders" as const, playbookId: "p" },
    {
      id: "c",
      text: "c",
      source: "catalog" as const,
      needs: "orders" as const,
      playbookAttempt: { outcome: "failed" as const, at: "x" },
    },
    { id: "d", text: "d", source: "catalog" as const },
    { id: "e", text: "e", source: "catalog" as const, needs: "bookings" as const },
  ];

  it("skips questions that have a playbook, were tried, need no platform or have no platform", () => {
    expect(questionsToGenerate(questions, forNeed).map((t) => t.question.id)).toEqual(["a"]);
  });

  it("naming a question retries an earlier attempt", () => {
    expect(questionsToGenerate(questions, forNeed, ["c"]).map((t) => t.question.id)).toEqual(["c"]);
  });

  it("never generates for a platform that is not connected", () => {
    expect(questionsToGenerate(questions, () => ({ ...shop, connected: false }))).toEqual([]);
  });
});

describe("generatePlaybooksFor", () => {
  it("drafts once even when called twice at the same time or again later", async () => {
    const planFn = jest.fn(async () => plan);
    await Promise.all([
      generatePlaybooksFor("o", forNeed, undefined, { plan: planFn }),
      generatePlaybooksFor("o", forNeed, undefined, { plan: planFn }),
    ]);
    await generatePlaybooksFor("o", forNeed, undefined, { plan: planFn });

    expect(playbookApi.createPlaybook).toHaveBeenCalledTimes(1);
    expect(state.setup.questions[0].playbookId).toBe("pb1");
    // Created as a draft: no status passed, nothing published.
    expect(playbookApi.createPlaybook.mock.calls[0][1].status).toBeUndefined();
    expect(playbookApi.publishDraft).not.toHaveBeenCalled();
  });

  it("generates in the org's language and from that plugin's tools only", async () => {
    const planFn = jest.fn(async (..._args: unknown[]) => plan);
    await generatePlaybooksFor("o", forNeed, undefined, { plan: planFn as never });
    expect(planFn.mock.calls[0][3]).toBe("pt-BR");
    expect((planFn.mock.calls[0][2] as Array<{ id: string }>).map((t) => t.id)).toEqual([
      "shop:shop_get_order",
    ]);
  });

  it("keeps write approval: lists the write categories the draft uses", async () => {
    const writer = {
      ...plan,
      tools: [
        { ...plan.tools[0], id: "shop:shop_create_refund", readOnly: false, category: "refund" },
      ],
    };
    await generatePlaybooksFor("o", forNeed, undefined, { plan: async () => writer });
    expect(playbookApi.updatePlaybook).toHaveBeenCalledWith("o", "pb1", {
      approvalCategories: ["refund"],
    });
  });

  it("marks the row, creates nothing, and does not retry on its own when no tool fits", async () => {
    const planFn = jest.fn(async () => ({ kind: "no_tool" as const }));
    await generatePlaybooksFor("o", forNeed, undefined, { plan: planFn });
    await generatePlaybooksFor("o", forNeed, undefined, { plan: planFn });
    expect(playbookApi.createPlaybook).not.toHaveBeenCalled();
    expect(planFn).toHaveBeenCalledTimes(1);
    expect(state.setup.questions[0].playbookAttempt).toMatchObject({ outcome: "no_tool" });
  });

  it("a thrown error marks only that row failed", async () => {
    await generatePlaybooksFor("o", forNeed, undefined, {
      plan: async () => {
        throw new Error("boom");
      },
    });
    expect(state.setup.questions[0].playbookAttempt).toMatchObject({ outcome: "failed" });
  });

  it("deletes a draft that lost a race instead of leaving a duplicate", async () => {
    const planFn = jest.fn(async () => {
      // Another call attached its playbook while this one was thinking.
      state.setup.questions[0].playbookId = "other";
      return plan;
    });
    await generatePlaybooksFor("o", forNeed, undefined, { plan: planFn });
    expect(state.setup.questions[0].playbookId).toBe("other");
    expect(playbookApi.deletePlaybook).toHaveBeenCalledWith("o", "pb1");
  });
});

describe("turnOnPlaybook", () => {
  const question = {
    id: "q1",
    text: "q",
    source: "catalog" as const,
    needs: "orders" as const,
    playbookId: "pb1",
  };
  const mention = (id: string) => ({
    type: "doc",
    content: [{ type: "mention", attrs: { id, type: "action", label: "x", pluginId: "shop" } }],
  });

  it("publishes the draft through publishDraft with the acting user", async () => {
    playbookApi.getPlaybook.mockResolvedValue({
      id: "pb1",
      status: "draft",
      instructions: mention("shop:shop_get_order"),
    });
    await turnOnPlaybook("o", "u1", question);
    expect(playbookApi.publishDraft).toHaveBeenCalledWith("o", "pb1", "u1");
    expect(playbookApi.updatePlaybook).not.toHaveBeenCalled();
  });

  it("is a no-op when the playbook is already on", async () => {
    playbookApi.getPlaybook.mockResolvedValue({ id: "pb1", status: "active", instructions: null });
    await turnOnPlaybook("o", "u1", question);
    expect(playbookApi.publishDraft).not.toHaveBeenCalled();
  });

  it("refuses when the draft names a tool that is gone, including a bare name", async () => {
    playbookApi.getPlaybook.mockResolvedValue({
      id: "pb1",
      status: "draft",
      instructions: mention("shop:shop_vanished"),
    });
    await expect(turnOnPlaybook("o", "u1", question)).rejects.toThrow(/no longer available/);
    playbookApi.getPlaybook.mockResolvedValue({
      id: "pb1",
      status: "draft",
      instructions: mention("shop_get_order"),
    });
    await expect(turnOnPlaybook("o", "u1", question)).rejects.toThrow();
    expect(playbookApi.publishDraft).not.toHaveBeenCalled();
  });

  it("needs a playbook to exist", async () => {
    await expect(turnOnPlaybook("o", "u1", { ...question, playbookId: undefined })).rejects.toThrow(
      /no playbook/,
    );
  });
});

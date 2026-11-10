import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/playbook.service", () => ({ PlaybookService: class {} }));
jest.mock("@server/services/mcp-registry.service", () => ({ mcpRegistryService: {} }));
jest.mock("@server/services/organization.service", () => ({ organizationService: {} }));

import {
  buildPlanPrompt,
  checkPlan,
  generatePlan,
  planToDocument,
  stepsFromInstructions,
  PLAN_JSON_SCHEMA,
  type GenerationTool,
} from "../../services/setup/playbook-generation";
import { approvalCategoriesFor, toGenerationTools } from "../../services/setup/playbooks";

const tool = (name: string, over: Partial<GenerationTool> = {}): GenerationTool => ({
  id: `shop:${name}`,
  pluginId: "shop",
  name,
  description: `${name} description`,
  readOnly: true,
  category: null,
  ...over,
});
const tools = [
  tool("shop_get_order"),
  tool("shop_create_refund", { readOnly: false, category: "refund" }),
];
const good = {
  request_needs: "Look the order up",
  matching_tools: ["shop:shop_get_order"],
  can_fulfil: true,
  title: "Order status",
  trigger: "A customer asks where their order is.",
  steps: [
    { text: "Ask for the order number.", tool: "" },
    { text: "Look the order up.", tool: "shop:shop_get_order" },
    { text: "Tell the customer the status.", tool: "" },
  ],
};
const answers = (...raw: unknown[]) => {
  const ask = jest.fn<(org: string, prompt: string) => Promise<string>>();
  for (const r of raw) {
    if (r instanceof Error) ask.mockRejectedValueOnce(r);
    else ask.mockResolvedValueOnce(typeof r === "string" ? r : JSON.stringify(r));
  }
  return ask;
};

describe("checkPlan", () => {
  it("accepts a plan that only cites known tools", () => {
    const r = checkPlan(JSON.stringify(good), tools);
    expect(r.kind).toBe("plan");
    if (r.kind === "plan") {
      expect(r.used.map((t) => t.id)).toEqual(["shop:shop_get_order"]);
      expect(r.plan.steps).toHaveLength(3);
    }
  });

  it("rejects a tool that does not exist, in matching_tools or in a step", () => {
    const invented = { ...good, matching_tools: ["shop:shop_get_parcel"] };
    expect(checkPlan(JSON.stringify(invented), tools)).toEqual({
      kind: "unknown_tools",
      unknownIds: ["shop:shop_get_parcel"],
    });
    // A bare name is not a valid reference either.
    const bare = { ...good, steps: [{ text: "Look up", tool: "shop_get_order" }] };
    expect(checkPlan(JSON.stringify(bare), tools)).toMatchObject({ kind: "unknown_tools" });
  });

  it("no suitable tool is a clean answer, not an error", () => {
    const none = {
      ...good,
      matching_tools: [],
      can_fulfil: false,
      title: "",
      trigger: "",
      steps: [],
    };
    expect(checkPlan(JSON.stringify(none), tools)).toEqual({ kind: "no_tool" });
  });

  it("a plan that never calls a tool is incomplete", () => {
    const noCalls = { ...good, steps: [{ text: "Say hello", tool: "" }] };
    expect(() => checkPlan(JSON.stringify(noCalls), tools)).toThrow();
  });
});

describe("generatePlan", () => {
  it("retries once when it cites an unknown tool, and tells the model which", async () => {
    const ask = answers({ ...good, matching_tools: ["shop:made_up"] }, good);
    const outcome = await generatePlan("o", "Where is my order?", tools, "en", { ask });
    expect(outcome.kind).toBe("plan");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][1]).toContain("shop:made_up");
  });

  it("gives up as failed after the retry", async () => {
    const ask = answers({ ...good, matching_tools: ["x:y"] }, new Error("boom"));
    expect(await generatePlan("o", "q", tools, "en", { ask })).toEqual({ kind: "failed" });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("unparsable output is retried the same way", async () => {
    const ask = answers("not json", good);
    expect((await generatePlan("o", "q", tools, "en", { ask })).kind).toBe("plan");
  });

  it("does not call the model when there are no tools, and does not retry a clean no", async () => {
    const ask = answers();
    expect(await generatePlan("o", "q", [], "en", { ask })).toEqual({ kind: "no_tool" });
    expect(ask).not.toHaveBeenCalled();

    const none = answers({ ...good, matching_tools: [], can_fulfil: false });
    expect(await generatePlan("o", "q", tools, "en", { ask: none })).toEqual({ kind: "no_tool" });
    expect(none).toHaveBeenCalledTimes(1);
  });
});

describe("prompt and schema", () => {
  it("asks for the org language and lists only the given tools", () => {
    const prompt = buildPlanPrompt("Where is my order?", tools, "Brazilian Portuguese");
    expect(prompt).toContain("in Brazilian Portuguese");
    expect(prompt).toContain("shop:shop_get_order (read)");
    expect(prompt).toContain("shop:shop_create_refund (write)");
  });

  it("is a strict schema: every property required, none extra", () => {
    expect([...PLAN_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(PLAN_JSON_SCHEMA.properties).sort(),
    );
    expect(PLAN_JSON_SCHEMA.additionalProperties).toBe(false);
    // Reasoning (the tools it found) comes before the verdict.
    const keys = Object.keys(PLAN_JSON_SCHEMA.properties);
    expect(keys.indexOf("matching_tools")).toBeLessThan(keys.indexOf("can_fulfil"));
  });
});

describe("planToDocument and stepsFromInstructions", () => {
  const checked = checkPlan(JSON.stringify(good), tools);
  if (checked.kind !== "plan") throw new Error("fixture");
  const doc = planToDocument(checked.plan, tools);

  it("writes action mentions with the prefixed id", () => {
    const mentions: Array<{ attrs: Record<string, string> }> = [];
    const walk = (n: any): void => {
      if (n?.type === "mention") mentions.push(n);
      (n?.content ?? []).forEach(walk);
    };
    walk(doc);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].attrs).toEqual({
      id: "shop:shop_get_order",
      type: "action",
      label: "shop_get_order",
      pluginId: "shop",
    });
  });

  it("reads the steps back for the review list, with the tool as an action chip", () => {
    expect(stepsFromInstructions(doc)).toEqual([
      [{ type: "text", text: "Ask for the order number." }],
      [
        { type: "text", text: "Look the order up. " },
        { type: "action", pluginId: "shop", tool: "shop_get_order", label: "shop_get_order" },
      ],
      [{ type: "text", text: "Tell the customer the status." }],
    ]);
  });

  it("reads editor-written mentions as chips, and falls back to paragraphs", () => {
    const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
    const mention = (attrs: Record<string, string | null>) => ({ type: "mention", attrs });
    const written = {
      type: "doc",
      content: [
        paragraph(
          { type: "text", text: "  If it fails,   " },
          mention({ id: null, type: "handoff", label: "Handoff to human", pluginId: null }),
        ),
        paragraph(
          { type: "text", text: "Send " },
          mention({ id: "doc-1", type: "document", label: "Returns", pluginId: null }),
          { type: "hardBreak" },
          { type: "text", text: "then " },
          mention({ id: "x", type: "action", label: "orphan_tool", pluginId: null }),
        ),
        paragraph({ type: "text", text: "   " }),
      ],
    };
    expect(stepsFromInstructions(written)).toEqual([
      [
        { type: "text", text: "If it fails, " },
        { type: "handoff", label: "Handoff to human" },
      ],
      [
        { type: "text", text: "Send " },
        { type: "document", label: "Returns" },
        { type: "text", text: " then orphan_tool" },
      ],
    ]);
  });
});

describe("tools and approval", () => {
  it("maps only the connected plugin's tools and keeps write categories", () => {
    const mapped = toGenerationTools(
      [
        {
          pluginId: "shop",
          name: "a",
          description: "d",
          risk: { readOnly: true, category: null, classified: true },
        },
        {
          pluginId: "shop",
          name: "b",
          description: "d",
          risk: { readOnly: false, category: "refund", classified: true },
        },
        {
          pluginId: "other",
          name: "c",
          description: "d",
          risk: { readOnly: true, category: null, classified: true },
        },
      ] as never,
      "shop",
    );
    expect(mapped.map((t) => t.id)).toEqual(["shop:a", "shop:b"]);
    expect(mapped[1]).toMatchObject({ readOnly: false, category: "refund" });
  });

  it("requires approval for the write categories the playbook uses", () => {
    expect(
      approvalCategoriesFor([
        tool("r"),
        tool("w", { readOnly: false, category: "refund" }),
        tool("n", { readOnly: false, category: "note" }),
        tool("d", { readOnly: false, category: "destructive" }),
      ]),
    ).toEqual(["refund", "note"]);
  });
});

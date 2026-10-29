import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ROOT } from "../lib/data";
import type { Platform } from "../lib/types";
import { loadKnowledge, loadPlaybooks, parsePlaybook, PLATFORMS } from "../hay/content";
import {
  actionPlaceholders,
  markdownToTiptap,
  parseFrontMatter,
  type TiptapNode,
} from "../hay/markdown";
import { seedHay, type SeedOptions, type TrpcClient } from "../hay/seed";
import { listPluginTools, pluginIdForTool } from "../hay/tools";
import { resolveOrg, resolvePlatforms } from "../seed-hay";

const ALL_STEPS = new Set(["settings", "agent", "docs", "playbooks"] as const);

function options(platform: Platform, overrides: Partial<SeedOptions> = {}): SeedOptions {
  return {
    platform,
    dryRun: false,
    playbookStatus: "active",
    steps: new Set(ALL_STEPS),
    log: () => {},
    ...overrides,
  };
}

/** Collects every node of a given type in a Tiptap tree. */
function nodesOfType(node: TiptapNode | { content?: TiptapNode[] }, type: string): TiptapNode[] {
  const own = "type" in node && node.type === type ? [node as TiptapNode] : [];
  return [...own, ...(node.content ?? []).flatMap((child) => nodesOfType(child, type))];
}

describe("parseFrontMatter", () => {
  it("reads strings, inline lists and block lists", () => {
    const { data, body } = parseFrontMatter(
      '---\ntitle: Where is my order\ntrigger: "Shopper asks: where?"\napprovalCategories: [refund, cancel]\nplatforms:\n  - shopify\n  - woocommerce\n---\n\n# Body\n',
    );
    expect(data).toEqual({
      title: "Where is my order",
      trigger: "Shopper asks: where?",
      approvalCategories: ["refund", "cancel"],
      platforms: ["shopify", "woocommerce"],
    });
    expect(body).toBe("# Body");
  });

  it("returns the whole text as body without front-matter", () => {
    expect(parseFrontMatter("Just text")).toEqual({ data: {}, body: "Just text" });
  });
});

describe("markdownToTiptap", () => {
  const doc = markdownToTiptap(
    [
      "# Title",
      "### Deep heading",
      "A **bold** and *italic* line",
      "that continues with `code`.",
      "",
      "- first {{action:shopify_get_order}}",
      "- second, **with {{action:shopify_get_order_tracking}} in bold**",
      "  continued",
      "",
      "1. one",
      "2. two",
    ].join("\n"),
    pluginIdForTool,
  );

  it("builds headings (clamped to level 2), paragraphs and lists", () => {
    expect(doc.content.map((n) => n.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
    ]);
    expect(doc.content[0].attrs).toEqual({ level: 1 });
    expect(doc.content[1].attrs).toEqual({ level: 2 });
    expect(doc.content[3].content).toHaveLength(2);
    expect(doc.content[4].content).toHaveLength(2);
  });

  it("applies bold, italic and code marks and joins wrapped lines", () => {
    expect(doc.content[2].content).toEqual([
      { type: "text", text: "A " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      { type: "text", text: "italic", marks: [{ type: "italic" }] },
      { type: "text", text: " line that continues with " },
      { type: "text", text: "code", marks: [{ type: "code" }] },
      { type: "text", text: "." },
    ]);
  });

  it("turns action placeholders into mention nodes with the plugin id, the dashboard editor's shape", () => {
    const mentions = nodesOfType(doc, "mention");
    expect(mentions).toEqual([
      {
        type: "mention",
        attrs: {
          id: "hay-plugin-shopify:shopify_get_order",
          label: "shopify_get_order",
          type: "action",
          pluginId: "hay-plugin-shopify",
        },
      },
      {
        type: "mention",
        attrs: {
          id: "hay-plugin-shopify:shopify_get_order_tracking",
          label: "shopify_get_order_tracking",
          type: "action",
          pluginId: "hay-plugin-shopify",
        },
      },
    ]);
    // Indented continuation joins the list item.
    const secondItem = doc.content[3].content?.[1];
    expect(JSON.stringify(secondItem)).toContain("continued");
  });

  it("maps each platform's tools to its plugin and rejects unknown prefixes", () => {
    expect(pluginIdForTool("woocommerce_get_order")).toBe("hay-plugin-woocommerce");
    expect(pluginIdForTool("nuvemshop_get_payment_link")).toBe("hay-plugin-nuvemshop");
    expect(() => markdownToTiptap("{{action:stripe_refund}}", pluginIdForTool)).toThrow(
      /no known plugin/,
    );
  });
});

describe("content files", () => {
  it("every {{action:…}} in playbooks/ names a tool the platform's plugin registers", () => {
    for (const platform of PLATFORMS) {
      const tools = new Set(listPluginTools(platform));
      expect(tools.size).toBeGreaterThan(10);
      const dir = join(ROOT, "playbooks", platform);
      const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
      expect(files.length).toBeGreaterThanOrEqual(8);
      for (const file of files) {
        const actions = actionPlaceholders(readFileSync(join(dir, file), "utf8"));
        for (const action of actions)
          expect(tools.has(action), `${platform}/${file}: ${action}`).toBe(true);
      }
    }
  });

  it("playbooks parse with unique titles, short triggers and scenario ids", () => {
    for (const platform of PLATFORMS) {
      const playbooks = loadPlaybooks(platform);
      expect(new Set(playbooks.map((p) => p.title)).size).toBe(playbooks.length);
      for (const p of playbooks) {
        expect(p.trigger.length).toBeLessThanOrEqual(255);
        expect(p.description).toMatch(/\b[A-Z]{3}-\d{2}\b/);
        expect(p.instructions.type).toBe("doc");
        expect(nodesOfType(p.instructions, "mention").length).toBe(
          actionPlaceholders(p.markdown).length,
        );
        expect(p.markdown).not.toMatch(/\bHay\b(?!\.chat)/);
      }
    }
  });

  it("knowledge is per store: US and EU get their own shipping, Brasil gets pt-BR", () => {
    const titles = (p: Platform) => loadKnowledge(p).map((d) => d.title);
    expect(titles("shopify")).toContain("Shipping (Casa Aurora US)");
    expect(titles("shopify")).not.toContain("Shipping (Casa Aurora Europe)");
    expect(titles("woocommerce")).toContain("Shipping (Casa Aurora Europe)");
    expect(titles("nuvemshop")).toContain("Envio e prazos (Casa Aurora Brasil)");
    for (const platform of PLATFORMS) {
      const docs = loadKnowledge(platform);
      expect(new Set(docs.map((d) => d.title)).size).toBe(docs.length);
    }
  });

  it("rejects an unknown approval category", () => {
    expect(() =>
      parsePlaybook(
        "---\ntitle: T\ntrigger: x\ndescription: d\napprovalCategories: [money]\n---\nbody",
        "t.md",
      ),
    ).toThrow(/unknown approval category/);
  });
});

/** In-memory fake of the tRPC routes the seed uses. */
function fakeApi(
  state: {
    documents?: { id: string; title: string; content: string; status: string }[];
    playbooks?: { id: string; title: string; agents: { id: string }[] }[];
    agents?: { id: string; name: string }[];
  } = {},
) {
  const calls: { kind: "query" | "mutation"; path: string; input: unknown }[] = [];
  const api: TrpcClient = {
    async query<T>(path: string, input?: unknown) {
      calls.push({ kind: "query", path, input });
      const results: Record<string, unknown> = {
        "documents.list": { items: state.documents ?? [], pagination: { hasNext: false } },
        "playbooks.list": state.playbooks ?? [],
        "agents.list": state.agents ?? [],
        "businessHours.list": [],
        "teamQuestions.getSettings": {
          enabled: false,
          updateAfterMinutes: 5,
          giveUpAfterMinutes: 10,
        },
      };
      return results[path] as T;
    },
    async mutation<T>(path: string, input?: unknown) {
      calls.push({ kind: "mutation", path, input });
      if (path === "agents.create") return { id: "00000000-0000-4000-8000-00000000a6e7" } as T;
      if (path.startsWith("playbooks.")) return { id: "pb-new", actionWarnings: [] } as T;
      return {} as T;
    },
  };
  return {
    api,
    calls,
    mutations: (path: string) => calls.filter((c) => c.kind === "mutation" && c.path === path),
  };
}

describe("seedHay", () => {
  it("dry-run sends nothing and needs no client", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const report = await seedHay(null, options("shopify", { dryRun: true, quickCheck: true }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(report.created.length).toBeGreaterThan(20);
    expect(report.actionWarnings).toEqual([]);

    const { api, calls } = fakeApi();
    await seedHay(api, options("nuvemshop", { dryRun: true }));
    expect(calls).toEqual([]);
  });

  it("creates everything in an empty org and attaches playbooks to the agent", async () => {
    const { api, mutations } = fakeApi();
    await seedHay(api, options("woocommerce", { quickCheck: true }));
    expect(mutations("organizations.updateSettings")[0].input).toEqual({
      timezone: "Europe/Lisbon",
      defaultLanguage: "en",
    });
    expect(mutations("businessHours.create")).toHaveLength(1);
    expect(mutations("teamQuestions.updateSettings")[0].input).toEqual({
      enabled: true,
      updateAfterMinutes: 5,
      giveUpAfterMinutes: 10,
    });
    expect(mutations("agents.create")).toHaveLength(1);
    expect(mutations("agents.setAsDefault")).toHaveLength(1);
    expect(mutations("documents.create")).toHaveLength(loadKnowledge("woocommerce").length);
    const created = mutations("playbooks.create");
    expect(created).toHaveLength(loadPlaybooks("woocommerce").length);
    for (const call of created) {
      expect(call.input).toMatchObject({
        status: "active",
        agentIds: ["00000000-0000-4000-8000-00000000a6e7"],
      });
    }
    // create takes no approvalCategories, so playbooks with categories get a follow-up update.
    const withCategories = loadPlaybooks("woocommerce").filter(
      (p) => p.approvalCategories.length > 0,
    );
    expect(mutations("playbooks.update")).toHaveLength(withCategories.length);
  });

  it("is idempotent: existing titles are updated in place, unchanged documents are skipped", async () => {
    const [firstDoc, secondDoc] = loadKnowledge("shopify");
    const [firstPlaybook] = loadPlaybooks("shopify");
    const agentId = "00000000-0000-4000-8000-0000000000a1";
    const { api, mutations } = fakeApi({
      agents: [{ id: agentId, name: "Casa Aurora Assistant" }],
      documents: [
        { id: "doc-1", title: firstDoc.title, content: firstDoc.content, status: "published" },
        { id: "doc-2", title: secondDoc.title, content: "old text", status: "published" },
      ],
      playbooks: [{ id: "pb-1", title: firstPlaybook.title, agents: [{ id: "other-agent" }] }],
    });
    const report = await seedHay(api, options("shopify", { playbookStatus: "draft" }));

    expect(mutations("agents.create")).toHaveLength(0);
    expect(mutations("agents.update")[0].input).toMatchObject({ id: agentId });
    expect(report.unchanged).toEqual([`document "${firstDoc.title}"`]);
    expect(mutations("documents.update").map((c) => c.input)).toEqual([
      { id: "doc-2", title: secondDoc.title, content: secondDoc.content, status: "published" },
    ]);
    expect(mutations("documents.create")).toHaveLength(loadKnowledge("shopify").length - 2);

    const update = mutations("playbooks.update").find(
      (c) => (c.input as { id: string }).id === "pb-1",
    );
    expect(update?.input).toMatchObject({
      data: { title: firstPlaybook.title, status: "draft", agentIds: ["other-agent", agentId] },
    });
    expect(mutations("playbooks.create")).toHaveLength(loadPlaybooks("shopify").length - 1);
  });

  it("only runs the requested steps", async () => {
    const { api, calls } = fakeApi();
    await seedHay(api, options("shopify", { steps: new Set(["docs"]) }));
    expect(new Set(calls.map((c) => c.path))).toEqual(
      new Set(["documents.list", "documents.create"]),
    );
  });
});

describe("CLI helpers", () => {
  it("resolves the org per platform: --org, then HAY_ORG_<PLATFORM>, then HAY_ORG_ID", () => {
    const env = { HAY_ORG_SHOPIFY: "org-us", HAY_ORG_ID: "org-any" };
    expect(resolveOrg("shopify", "org-flag", env)).toBe("org-flag");
    expect(resolveOrg("shopify", undefined, env)).toBe("org-us");
    expect(resolveOrg("nuvemshop", undefined, env)).toBe("org-any");
    expect(resolveOrg("nuvemshop", undefined, {})).toBeUndefined();
  });

  it("--platform all picks the platforms that have an org (all of them in dry-run)", () => {
    expect(resolvePlatforms("all", false, { HAY_ORG_NUVEMSHOP: "x" })).toEqual(["nuvemshop"]);
    expect(resolvePlatforms("all", true, {})).toEqual(["shopify", "woocommerce", "nuvemshop"]);
    expect(() => resolvePlatforms("all", false, {})).toThrow(/HAY_ORG_SHOPIFY/);
    expect(() => resolvePlatforms("magento", false, {})).toThrow(/Unknown --platform/);
  });
});

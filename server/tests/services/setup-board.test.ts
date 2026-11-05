import { describe, it, expect } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/organization.service", () => ({ organizationService: {} }));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {},
  isPluginVisibleToOrganization: () => true,
}));
jest.mock("@server/services/setup/site", () => ({
  ...jest.requireActual("@server/services/setup/site"),
}));
jest.mock("@server/services/setup/check", () => ({
  ...jest.requireActual("@server/services/setup/check"),
}));
jest.mock("@server/services/document-source-sync.service", () => ({
  documentSourceSyncService: {},
}));
jest.mock("@server/services/vector-store.service", () => ({ vectorStoreService: {} }));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/web-scraper.service", () => ({ WebScraperService: class {} }));
jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: {},
}));

import { buildBoard, type BoardFacts } from "../../services/setup/board";
import { catalogFor, findCatalogQuestion } from "../../services/setup/catalog";
import { mergeQuestions, needsCheck } from "../../services/setup/setup.service";
import { resolveSiteState } from "../../services/setup/site";
import { BUSINESS_TYPES, SETUP_HANDLES, type SetupQuestion } from "@server/types/setup.types";
import { DocumentSourceSyncStatus } from "@server/entities/document-source.entity";
import { JobStatus } from "@server/entities/job.entity";

const NOW = "2026-11-05T10:00:00.000Z";
const PASSED = { state: "passed" } as const;
const LATER = "2026-11-05T10:05:00.000Z";
const siteOf = (state: "none" | "reading" | "done" | "failed", syncedAt?: string) => ({
  state: { state, discovered: 0, processed: 0 },
  syncedAt,
});
const doc = (id: string, check?: SetupQuestion["check"]): SetupQuestion => ({
  id,
  text: id,
  source: "catalog",
  check,
});
const facts = (over: Partial<BoardFacts>): BoardFacts => ({
  setup: { toolPluginIds: [], channels: [], questions: [] },
  site: siteOf("done"),
  plugins: [],
  playbooks: [],
  hasRealConversations: false,
  ...over,
});
const statusOf = (q: SetupQuestion, over: Partial<BoardFacts> = {}) =>
  buildBoard(
    facts({
      setup: { toolPluginIds: [], channels: [], questions: [q] },
      ...over,
    }),
  ).rows[0].status;

describe("row statuses", () => {
  it("document question without a check", () => {
    expect(statusOf(doc("a"), { site: siteOf("reading") })).toBe("reading_site");
    expect(statusOf(doc("a"), { site: siteOf("done") })).toBe("checking");
  });

  it("not answered is reading_site while the crawl runs, missing after", () => {
    const check = { outcome: "not_answered" as const, sources: [], checkedAt: NOW };
    expect(statusOf(doc("a", check), { site: siteOf("reading") })).toBe("reading_site");
    expect(statusOf(doc("a", check), { site: siteOf("done", NOW) })).toBe("missing");
  });

  it("not answered before the last read is checked again, not missing", () => {
    const check = { outcome: "not_answered" as const, sources: [], checkedAt: NOW };
    expect(statusOf(doc("a", check), { site: siteOf("done", LATER) })).toBe("checking");
  });

  it("answered is ready with answer and sources; a search failure is check_failed, never missing", () => {
    const sources = [{ documentId: "d1", title: "Returns", url: "https://x.com/r" }];
    const board = buildBoard(
      facts({
        setup: {
          toolPluginIds: [],
          channels: [],
          questions: [
            doc("a", {
              outcome: "answered",
              answer: "30 days",
              sources,
              checkedAt: NOW,
              turn: PASSED,
            }),
            doc("b", { outcome: "failed", sources: [], checkedAt: NOW }),
          ],
        },
      }),
    );
    expect(board.rows.map((r) => r.status)).toEqual(["ready", "check_failed"]);
    expect(board.rows[0]).toMatchObject({ answer: "30 days", sources });
  });

  it("marks the customer's own saved answer, and it survives a recheck", () => {
    const sources = [
      { documentId: "own", title: "a" },
      { documentId: "page", title: "Returns" },
    ];
    const question = {
      ...doc("a", {
        outcome: "answered",
        answer: "30 days",
        sources,
        checkedAt: NOW,
        turn: PASSED,
      }),
      answerDocumentId: "own",
    };
    const board = buildBoard(
      facts({ setup: { toolPluginIds: [], channels: [], questions: [question] } }),
    );
    expect(board.rows[0].sources.map((s) => s.own)).toEqual([true, undefined]);
  });

  it("platform questions need a connection until a playbook exists; plugin comes from handles", () => {
    const q: SetupQuestion = { id: "o", text: "Where?", source: "catalog", needs: "orders" };
    const plugins = [
      {
        id: "shop",
        name: "Shop",
        handles: ["orders" as const],
        businessTypes: [],
        connected: false,
      },
    ];
    const connected = plugins.map((p) => ({ ...p, connected: true }));
    const base = { toolPluginIds: ["shop"], channels: [], questions: [q] };
    expect(buildBoard(facts({ setup: base, plugins })).rows[0]).toMatchObject({
      status: "needs_connection",
      plugin: { id: "shop", name: "Shop" },
    });
    expect(
      buildBoard(facts({ setup: { ...base, toolPluginIds: [] }, plugins })).rows[0].plugin,
    ).toBeUndefined();

    const withPlaybook = { ...base, questions: [{ ...q, playbookId: "p1" }] };
    // Connected, but a playbook has not been drafted yet.
    expect(buildBoard(facts({ setup: base, plugins: connected })).rows[0]).toMatchObject({
      status: "playbook_missing",
      generation: "pending",
    });
    // A playbook never makes a row ready while its platform is not connected.
    expect(
      buildBoard(
        facts({
          setup: withPlaybook,
          plugins,
          playbooks: [{ id: "p1", title: "T", active: true, steps: [] }],
        }),
      ).rows[0].status,
    ).toBe("needs_connection");
    expect(
      buildBoard(
        facts({
          setup: withPlaybook,
          plugins: connected,
          playbooks: [{ id: "p1", title: "T", active: false, steps: ["Ask", "Look up"] }],
        }),
      ).rows[0],
    ).toMatchObject({
      status: "playbook_off",
      playbook: { id: "p1", title: "T", steps: ["Ask", "Look up"] },
    });
    expect(
      buildBoard(
        facts({
          setup: withPlaybook,
          plugins: connected,
          playbooks: [{ id: "p1", title: "T", active: true, steps: [] }],
        }),
      ).rows[0].status,
    ).toBe("ready");
  });
});

describe("upNext order and counts", () => {
  const answered = {
    outcome: "answered" as const,
    answer: "x",
    sources: [],
    checkedAt: NOW,
    turn: PASSED,
  };
  const missing = { outcome: "not_answered" as const, sources: [], checkedAt: NOW };
  const plugins = [
    {
      id: "shop",
      name: "Shop",
      handles: ["orders" as const, "refunds" as const],
      businessTypes: [],
      connected: false,
    },
  ];
  const need = (id: string, needs: "orders" | "refunds" | "billing"): SetupQuestion => ({
    id,
    text: id,
    source: "catalog",
    needs,
  });

  it("connect (largest unlocks) beats everything", () => {
    const board = buildBoard(
      facts({
        plugins,
        setup: {
          toolPluginIds: ["shop"],
          channels: [],
          questions: [doc("m", missing), need("o", "orders"), need("r", "refunds")],
        },
      }),
    );
    expect(board.upNext).toEqual({
      kind: "connect",
      plugin: { id: "shop", name: "Shop" },
      unlocks: 2,
      capability: "orders",
    });
  });

  it("choose_platform when no chosen tool handles the need", () => {
    const board = buildBoard(
      facts({ setup: { toolPluginIds: [], channels: [], questions: [need("o", "orders")] } }),
    );
    expect(board.upNext).toEqual({ kind: "choose_platform", unlocks: 1, capability: "orders" });
  });

  it("then playbook, then answer, then done", () => {
    const off = { ...need("o", "orders"), playbookId: "p" };
    const withOff = buildBoard(
      facts({
        plugins: plugins.map((p) => ({ ...p, connected: true })),
        playbooks: [{ id: "p", title: "Order status", active: false, steps: [] }],
        setup: { toolPluginIds: ["shop"], channels: [], questions: [doc("m", missing), off] },
      }),
    );
    expect(withOff.upNext).toEqual({ kind: "playbook", questionId: "o", title: "Order status" });

    const withMissing = buildBoard(
      facts({
        site: siteOf("done", NOW),
        setup: {
          toolPluginIds: [],
          channels: [],
          questions: [doc("m", missing), doc("a", answered)],
        },
      }),
    );
    expect(withMissing.upNext).toMatchObject({ kind: "answer", questionId: "m" });
    expect(withMissing).toMatchObject({ readyCount: 1, totalCount: 2 });

    const done = buildBoard(
      facts({ setup: { toolPluginIds: [], channels: [], questions: [doc("a", answered)] } }),
    );
    expect(done.upNext).toEqual({ kind: "done" });
  });
});

describe("shouldPrompt", () => {
  const open = { toolPluginIds: [], channels: [], questions: [] };
  it("only while setup is open and no real conversation exists", () => {
    expect(buildBoard(facts({ setup: open })).shouldPrompt).toBe(true);
    expect(buildBoard(facts({ setup: open, hasRealConversations: true })).shouldPrompt).toBe(false);
    expect(buildBoard(facts({ setup: { ...open, dismissedAt: NOW } })).shouldPrompt).toBe(false);
    expect(buildBoard(facts({ setup: { ...open, finishedAt: NOW } })).shouldPrompt).toBe(false);
  });
});

describe("site state", () => {
  const source = (status: DocumentSourceSyncStatus, synced = true) =>
    ({
      id: "s",
      lastSyncStatus: status,
      lastSyncedAt: synced ? new Date(NOW) : undefined,
    }) as never;

  it("maps the newest job and source to four states", () => {
    expect(resolveSiteState({ source: null }).state.state).toBe("none");
    expect(resolveSiteState({ source: null, website: "https://bad" }).state.state).toBe("failed");
    expect(
      resolveSiteState({
        source: source(DocumentSourceSyncStatus.RUNNING),
        jobStatus: JobStatus.PROCESSING,
        progress: { discovered: 10, processed: 4, total: 40 },
      }).state,
    ).toMatchObject({ state: "reading", discovered: 10, processed: 4, total: 40 });
    expect(
      resolveSiteState({ source: source(DocumentSourceSyncStatus.IDLE, false) }).state.state,
    ).toBe("reading");
    expect(
      resolveSiteState({
        source: source(DocumentSourceSyncStatus.SUCCESS),
        jobStatus: JobStatus.COMPLETED,
      }).state.state,
    ).toBe("done");
    expect(
      resolveSiteState({
        source: source(DocumentSourceSyncStatus.ERROR),
        jobStatus: JobStatus.COMPLETED,
      }).state.state,
    ).toBe("failed");
  });
});

describe("catalog", () => {
  it("has every type in both languages, store deepest, handles from the vocabulary", () => {
    const counts = BUSINESS_TYPES.map((t) => catalogFor(t, "en").length);
    expect(Math.max(...counts)).toBe(catalogFor("store", "en").length);
    for (const type of BUSINESS_TYPES) {
      const en = catalogFor(type, "en");
      const pt = catalogFor(type, "pt-BR");
      expect(pt.map((q) => q.id)).toEqual(en.map((q) => q.id));
      expect(new Set(en.map((q) => q.id)).size).toBe(en.length);
      en.forEach((q, i) => {
        expect(q.text).not.toBe(pt[i].text.length === 0 ? "" : "\0");
        if (q.needs) expect(SETUP_HANDLES).toContain(q.needs);
      });
    }
  });

  it("uses the org language and falls back to English", () => {
    expect(catalogFor("store", "pt")[0].text).toBe("Qual é a política de troca e devolução?");
    expect(catalogFor("store", "de")[0].text).toBe("What is your return policy?");
    expect(catalogFor("store", undefined)[0].text).toBe("What is your return policy?");
  });

  it("never names a plugin", () => {
    const text = JSON.stringify(BUSINESS_TYPES.flatMap((t) => catalogFor(t, "en"))).toLowerCase();
    for (const name of ["shopify", "stripe", "woocommerce", "hubspot", "zendesk"]) {
      expect(text).not.toContain(name);
    }
    expect(findCatalogQuestion("store.refund")?.needs).toBe("refunds");
  });
});

describe("saveAnswers merge", () => {
  const check = { outcome: "answered" as const, answer: "30 days", sources: [], checkedAt: NOW };
  const stored: SetupQuestion[] = [
    { id: "store.returns", text: "What is your return policy?", source: "catalog", check },
    {
      id: "store.refund",
      text: "I want a refund",
      source: "catalog",
      needs: "refunds",
      playbookId: "p1",
    },
    { id: "custom.1", text: "Gift wrap?", source: "custom", check },
  ];

  it("keeps check and playbook of unchanged questions", () => {
    const merged = mergeQuestions(stored, [
      { id: "store.returns", text: "What is your return policy?" },
      { id: "store.refund", text: "I want a refund" },
      { id: "store.contact", text: "How can I contact you?" },
    ]);
    expect(merged[0].check).toEqual(check);
    expect(merged[1]).toMatchObject({ playbookId: "p1", needs: "refunds" });
    expect(merged[2]).toMatchObject({ id: "store.contact", source: "catalog" });
    expect(merged[2].check).toBeUndefined();
  });

  it("drops a check made for old wording but keeps the playbook; removes omitted questions", () => {
    const merged = mergeQuestions(stored, [
      { id: "store.returns", text: "Can I return things?" },
      { id: "store.refund", text: "Refund please" },
    ]);
    expect(merged.map((q) => q.id)).toEqual(["store.returns", "store.refund"]);
    expect(merged[0].check).toBeUndefined();
    expect(merged[1].playbookId).toBe("p1");
  });

  it("gives new custom questions server ids and ignores duplicates", () => {
    const merged = mergeQuestions(
      [],
      [
        { text: "Do you do X?" },
        { id: "made-up", text: "Do you do Y?" },
        { id: "store.returns", text: "a" },
        { id: "store.returns", text: "b" },
      ],
    );
    expect(merged).toHaveLength(4 - 1);
    expect(merged[0].id).toMatch(/^custom\./);
    expect(merged[1].id).not.toBe("made-up");
  });
});

describe("needsCheck", () => {
  const nots = { outcome: "not_answered" as const, sources: [], checkedAt: NOW };
  it("rechecks unchecked, failed and stale not-answered; never platform or answered", () => {
    expect(needsCheck(doc("a"), siteOf("done"))).toBe(true);
    expect(
      needsCheck(doc("a", { outcome: "failed", sources: [], checkedAt: NOW }), siteOf("done")),
    ).toBe(true);
    expect(needsCheck(doc("a", nots), siteOf("done", LATER))).toBe(true);
    expect(needsCheck(doc("a", nots), siteOf("reading", LATER))).toBe(false);
    expect(needsCheck(doc("a", nots), siteOf("done", NOW))).toBe(false);
    expect(needsCheck({ ...doc("a"), needs: "orders" }, siteOf("done"))).toBe(false);
  });
});

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

const findDocuments = jest.fn();
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { query: jest.fn(), getRepository: () => ({ find: findDocuments }) },
}));
jest.mock("@server/services/organization.service", () => ({
  organizationService: { findOne: jest.fn().mockResolvedValue({ defaultLanguage: "en" }) },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { getAllPlugins: jest.fn(() => []) },
  isPluginVisibleToOrganization: () => true,
}));
jest.mock("@server/services/document-source-sync.service", () => ({
  documentSourceSyncService: {},
}));
const vectorStore = {
  initialized: true,
  deleteByDocumentId: jest.fn(),
  addChunks: jest.fn(),
};
jest.mock("@server/services/vector-store.service", () => ({ vectorStoreService: vectorStore }));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/web-scraper.service", () => ({ WebScraperService: class {} }));
jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: {},
}));
const documents = {
  findByIdAndOrganization: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: documents }));

const events: string[] = [];
const store = { current: {} as Record<string, unknown> };
jest.mock("@server/services/setup/store", () => ({
  readSetup: jest.fn(async () => store.current),
  updateSetup: jest.fn(async (_org: string, change: (c: unknown) => unknown) => {
    events.push("persist");
    store.current = change(store.current) as typeof store.current;
    return store.current;
  }),
}));

const cheap = jest.fn();
jest.mock("@server/services/setup/check", () => ({
  ...(jest.requireActual("@server/services/setup/check") as object),
  checkQuestion: (...args: unknown[]) => cheap(...args),
}));
const readSiteState = jest.fn();
jest.mock("@server/services/setup/site", () => ({
  ...(jest.requireActual("@server/services/setup/site") as object),
  readSiteState: (...args: unknown[]) => readSiteState(...args),
}));
const saveAnswerDocument = jest.fn();
const retitleAnswerDocument = jest.fn();
const answerDocument = jest.requireActual("@server/services/setup/answer-document") as {
  saveAnswerDocument: (...args: unknown[]) => Promise<unknown>;
  retitleAnswerDocument: (...args: unknown[]) => Promise<unknown>;
};
jest.mock("@server/services/setup/answer-document", () => ({
  saveAnswerDocument: (...args: unknown[]) => saveAnswerDocument(...args),
  retitleAnswerDocument: (...args: unknown[]) => retitleAnswerDocument(...args),
}));
const startTurns = jest.fn();
jest.mock("@server/services/setup/turn", () => ({
  startTurns: (...args: unknown[]) => startTurns(...args),
  readTurn: jest.fn(async () => "pending"),
}));

import {
  checkQuestions,
  draftAnswer,
  getAnswer,
  MAX_QUESTIONS,
  removeQuestion,
  restoreQuestion,
  updateQuestion,
} from "../../services/setup/setup.service";
import {
  draftAnswerFromDocument,
  loadOwnAnswers,
  preferOwnAnswer,
  type DraftDeps,
} from "../../services/setup/check";
import {
  answerTextOf,
  answerToHtml,
  answerToTiptapJson,
  plainTextOf,
} from "../../services/setup/answer-text";
import { buildRow, type BoardFacts } from "../../services/setup/board";
import { DocumentationStatus, ImportMethod } from "@server/entities/document.entity";
import type { Document } from "@server/entities/document.entity";
import type { SetupCheckResult, SetupQuestion } from "@server/types/setup.types";

const checkedAt = "2026-11-05T10:00:00.000Z";
const done = { state: { state: "done", discovered: 1, processed: 1 }, syncedAt: undefined };
const question = (over: Partial<SetupQuestion> = {}): SetupQuestion => ({
  id: "q1",
  text: "Do you offer refunds?",
  source: "custom",
  ...over,
});
const other = (id: string, title: string, content = "<p>Other.</p>") =>
  ({ id, title, content, status: DocumentationStatus.PUBLISHED }) as Document;
const own = other("own1", "Do you offer refunds?", "<p>Yes, 30 days.</p>");
const wrong: SetupCheckResult = {
  outcome: "answered",
  answer: "Wrong.",
  sources: [{ documentId: "wrong1", title: "Pricing" }],
  checkedAt,
};
const stored = () => store.current.questions as SetupQuestion[];
const seed = (questions: SetupQuestion[], extra: Record<string, unknown> = {}) => {
  store.current = { toolPluginIds: [], channels: [], questions, ...extra };
};

beforeEach(() => {
  events.length = 0;
  seed([question()]);
  cheap.mockReset().mockImplementation(async () => {
    events.push("check");
    return { outcome: "not_answered", sources: [], checkedAt };
  });
  readSiteState.mockReset().mockResolvedValue(done);
  startTurns.mockReset().mockImplementation(async (_org: unknown, qs: unknown) => {
    events.push("turn");
    return new Map(
      (qs as { id: string }[]).map((q) => [
        q.id,
        { state: "pending", runId: "r", ref: `ref-${q.id}`, startedAt: checkedAt },
      ]),
    );
  });
  saveAnswerDocument.mockReset().mockImplementation(async () => {
    events.push("document");
    return own;
  });
  retitleAnswerDocument.mockReset();
  findDocuments.mockReset().mockResolvedValue([own]);
  documents.findByIdAndOrganization.mockReset().mockResolvedValue(null);
  documents.create.mockReset().mockImplementation(async (d: object) => ({ id: "new1", ...d }));
  documents.update.mockReset().mockImplementation(async (id: string, _o: string, d: object) => ({
    id,
    title: "T",
    ...d,
  }));
  vectorStore.deleteByDocumentId.mockReset();
  vectorStore.addChunks.mockReset();
  (
    jest.requireMock("@server/database/data-source") as { AppDataSource: { query: jest.Mock } }
  ).AppDataSource.query.mockResolvedValue([]);
});

describe("answer text and editor fields", () => {
  it("builds a valid Tiptap doc: one paragraph per line, no empty text nodes", () => {
    const doc = answerToTiptapJson("First\n\nSecond") as {
      type: string;
      content: { type: string; content?: { type: string; text: string }[] }[];
    };
    expect(doc.type).toBe("doc");
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "First" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "Second" }] },
    ]);
  });

  it("escapes HTML in the stored content and round-trips to the same text", () => {
    const html = answerToHtml("a < b & <script>x</script>\n\nnext");
    expect(html).toBe("<p>a &lt; b &amp; &lt;script&gt;x&lt;/script&gt;</p><p></p><p>next</p>");
    expect(plainTextOf(html)).toBe("a < b & <script>x</script>\n\nnext");
  });

  it("is editable for paragraphs, breaks and plain text saved earlier", () => {
    expect(answerTextOf("<p>One</p><p>Two<br>three</p>")).toEqual({
      text: "One\nTwo\nthree",
      editable: true,
    });
    expect(answerTextOf("Plain, saved before.\nTwo lines.")).toEqual({
      text: "Plain, saved before.\nTwo lines.",
      editable: true,
    });
  });

  it("is not editable once it has lists, links, marks or headings", () => {
    for (const html of [
      "<ul><li>One</li></ul>",
      '<p><a href="https://x.com">link</a></p>',
      "<p><strong>bold</strong></p>",
      "<h2>Title</h2>",
    ]) {
      expect(answerTextOf(html).editable).toBe(false);
    }
  });
});

describe("saveAnswerDocument", () => {
  it("creates an editor FAQ with HTML and contentJson and embeds title and text", async () => {
    await answerDocument.saveAnswerDocument("org", { title: "Refunds?", text: "Yes.\n\nSoon." });
    expect(documents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org",
        title: "Refunds?",
        type: "faq",
        importMethod: ImportMethod.EDITOR,
        content: "<p>Yes.</p><p></p><p>Soon.</p>",
        contentJson: answerToTiptapJson("Yes.\n\nSoon."),
      }),
    );
    const chunks = vectorStore.addChunks.mock.calls[0][2] as { content: string }[];
    expect(chunks[0].content).toContain("Refunds?");
    expect(chunks[0].content).toContain("Yes.");
    expect(chunks[0].content).not.toContain("<p>");
  });

  it("updates the existing document in place and replaces its chunks", async () => {
    await answerDocument.saveAnswerDocument("org", {
      existing: own,
      title: "Refunds?",
      text: "New.",
    });
    expect(documents.create).not.toHaveBeenCalled();
    expect(documents.update).toHaveBeenCalledWith("own1", "org", expect.objectContaining({}));
    expect(vectorStore.deleteByDocumentId).toHaveBeenCalledWith("org", "own1");
  });

  it("marks the document errored and raises when embedding fails", async () => {
    vectorStore.addChunks.mockRejectedValue(new Error("embed down"));
    await expect(
      answerDocument.saveAnswerDocument("org", { title: "Refunds?", text: "Yes." }),
    ).rejects.toThrow("Could not save the answer");
    expect(documents.update).toHaveBeenCalledWith("new1", "org", {
      status: DocumentationStatus.ERROR,
    });
  });

  it("retitling re-embeds under the new title", async () => {
    await answerDocument.retitleAnswerDocument("org", own, "Returns?");
    expect(documents.update).toHaveBeenCalledWith("own1", "org", { title: "Returns?" });
    const chunks = vectorStore.addChunks.mock.calls[0][2] as { content: string }[];
    expect(chunks[0].content).toContain("Returns?");
    expect(chunks[0].content).toContain("Yes, 30 days.");
  });
});

describe("own answer wins", () => {
  it("replaces a not_answered or another document's answer, with the row's own source", () => {
    for (const result of [wrong, { ...wrong, outcome: "not_answered" as const, sources: [] }]) {
      expect(preferOwnAnswer(result, own)).toEqual({
        outcome: "answered",
        answer: "Yes, 30 days.",
        sources: [{ documentId: "own1", title: "Do you offer refunds?" }],
        checkedAt,
      });
    }
  });

  it("a failed check stays failed, and without an own document nothing changes", () => {
    const failed: SetupCheckResult = { outcome: "failed", sources: [], checkedAt };
    expect(preferOwnAnswer(failed, own)).toBe(failed);
    expect(preferOwnAnswer(wrong, undefined)).toBe(wrong);
  });

  it("loads all own documents in one organization-scoped query, and none when there are none", async () => {
    const found = await loadOwnAnswers("org", [
      question({ id: "a", answerDocumentId: "own1" }),
      question({ id: "b", answerDocumentId: "gone" }),
      question({ id: "c" }),
    ]);
    expect(findDocuments).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(findDocuments.mock.calls[0][0])).toContain('"organizationId":"org"');
    expect([...found.keys()]).toEqual(["a"]);

    findDocuments.mockClear();
    await loadOwnAnswers("org", [question()]);
    expect(findDocuments).not.toHaveBeenCalled();
  });

  it("a retry recheck keeps the own answer as the source when the check cites another document", async () => {
    seed([question({ answerDocumentId: "own1", check: { ...wrong, outcome: "failed" } })]);
    cheap.mockResolvedValue(wrong);
    await checkQuestions("org", ["q1"]);
    expect(stored()[0].check).toMatchObject({
      outcome: "answered",
      answer: "Yes, 30 days.",
      sources: [{ documentId: "own1" }],
    });
  });

  it("a failed recheck stays failed even with an own answer", async () => {
    seed([question({ answerDocumentId: "own1" })]);
    cheap.mockResolvedValue({ outcome: "failed", sources: [], checkedAt });
    await checkQuestions("org", ["q1"]);
    expect(stored()[0].check?.outcome).toBe("failed");
  });

  it("a deleted own document behaves as if the row had none", async () => {
    seed([question({ answerDocumentId: "gone" })]);
    cheap.mockResolvedValue(wrong);
    await checkQuestions("org", ["q1"]);
    expect(stored()[0].check).toMatchObject({
      answer: "Wrong.",
      sources: [{ documentId: "wrong1" }],
    });
  });
});

describe("updateQuestion", () => {
  it("puts the answer and link on every row status", () => {
    const q = question({
      answerDocumentId: "own1",
      linkedDocument: { id: "d9", title: "Returns page" },
    });
    const facts: BoardFacts = {
      setup: { toolPluginIds: [], channels: [], questions: [q] },
      site: done as BoardFacts["site"],
      plugins: [],
      playbooks: [],
      hasRealConversations: false,
      channels: [],
    };
    expect(buildRow(q, facts)).toMatchObject({
      status: "checking",
      answerDocumentId: "own1",
      linkedDocument: { id: "d9", title: "Returns page" },
    });
  });

  it("writes the document first, then persists, then rechecks", async () => {
    await updateQuestion("org", { questionId: "q1", answer: "Yes, 30 days." });
    expect(events).toEqual(["document", "persist", "check", "turn", "persist"]);
    expect(saveAnswerDocument).toHaveBeenCalledWith("org", {
      existing: null,
      title: "Do you offer refunds?",
      text: "Yes, 30 days.",
    });
    expect(stored()[0]).toMatchObject({ answerDocumentId: "own1" });
  });

  it("updates the question's one answer document instead of creating another", async () => {
    seed([question({ answerDocumentId: "own1" })]);
    documents.findByIdAndOrganization.mockResolvedValue(own);
    await updateQuestion("org", { questionId: "q1", answer: "Changed." });
    expect(saveAnswerDocument).toHaveBeenCalledWith(
      "org",
      expect.objectContaining({ existing: own }),
    );
  });

  it("keeps the own answer as the source when the check cites another document", async () => {
    cheap.mockResolvedValue(wrong);
    seed([question({ answerDocumentId: "own1" })]);
    documents.findByIdAndOrganization.mockResolvedValue(own);
    await updateQuestion("org", { questionId: "q1", answer: "Yes, 30 days." });
    expect(stored()[0].check).toMatchObject({ sources: [{ documentId: "own1" }] });
  });

  it("rejects answer or link on a platform row, and writes nothing", async () => {
    seed([question({ needs: "orders" })]);
    await expect(updateQuestion("org", { questionId: "q1", answer: "x" })).rejects.toThrow(
      "connected platform",
    );
    await expect(
      updateQuestion("org", { questionId: "q1", linkedDocumentId: null }),
    ).rejects.toThrow("connected platform");
    expect(saveAnswerDocument).not.toHaveBeenCalled();
  });

  it("returns the board without a recheck when nothing changed", async () => {
    await updateQuestion("org", { questionId: "q1", text: "Do you offer refunds?" });
    expect(events).toEqual([]);
  });

  it("rejects a duplicate of another question, case-insensitively", async () => {
    seed([question(), question({ id: "q2", text: "Where is my order?" })]);
    await expect(
      updateQuestion("org", { questionId: "q1", text: "where is my ORDER?" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(stored()[0].text).toBe("Do you offer refunds?");
  });

  it("links a document of this organization, storing its id and title; null clears it", async () => {
    documents.findByIdAndOrganization.mockResolvedValue(other("d9", "Returns page"));
    await updateQuestion("org", { questionId: "q1", linkedDocumentId: "d9" });
    expect(stored()[0].linkedDocument).toEqual({ id: "d9", title: "Returns page" });

    await updateQuestion("org", { questionId: "q1", linkedDocumentId: null });
    expect(stored()[0].linkedDocument).toBeUndefined();
  });

  it("refuses a missing document and the row's own answer document", async () => {
    await expect(
      updateQuestion("org", { questionId: "q1", linkedDocumentId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    seed([question({ answerDocumentId: "own1" })]);
    await expect(
      updateQuestion("org", { questionId: "q1", linkedDocumentId: "own1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rename keeps id, source and playbook, clears the check, rechecks under the new text", async () => {
    seed([question({ playbookId: "p1", check: { ...wrong, turn: { state: "passed" } } })]);
    await updateQuestion("org", { questionId: "q1", text: "What is your refund policy?" });
    expect(cheap).toHaveBeenCalledWith("org", "What is your refund policy?");
    expect(stored()[0]).toMatchObject({
      id: "q1",
      source: "custom",
      playbookId: "p1",
      text: "What is your refund policy?",
    });
    expect(stored()[0].check?.outcome).toBe("not_answered");
  });

  it("rename retitles an untouched answer document, and leaves a changed title alone", async () => {
    seed([question({ answerDocumentId: "own1" })]);
    documents.findByIdAndOrganization.mockResolvedValue(own);
    await updateQuestion("org", { questionId: "q1", text: "Returns?" });
    expect(retitleAnswerDocument).toHaveBeenCalledWith("org", own, "Returns?");

    retitleAnswerDocument.mockClear();
    seed([question({ answerDocumentId: "own1" })]);
    documents.findByIdAndOrganization.mockResolvedValue({ ...own, title: "My own title" });
    await updateQuestion("org", { questionId: "q1", text: "Returns?" });
    expect(retitleAnswerDocument).not.toHaveBeenCalled();
  });

  it("rename of a platform row keeps its playbook and skips the recheck", async () => {
    seed([question({ needs: "orders", playbookId: "p1" })]);
    await updateQuestion("org", { questionId: "q1", text: "Where is my parcel?" });
    expect(stored()[0]).toMatchObject({ text: "Where is my parcel?", playbookId: "p1" });
    expect(cheap).not.toHaveBeenCalled();
    expect(startTurns).not.toHaveBeenCalled();
  });
});

describe("draftAnswer", () => {
  const usable = other(
    "d1",
    "Returns",
    "<h1>Returns</h1><p>You can return items within 30 days.</p>",
  );
  const reply = (over: object = {}) =>
    JSON.stringify({
      evidence: "within 30 days",
      states_the_fact: true,
      answer: "  Yes, within 30 days.  ",
      passage_numbers: [1],
      ...over,
    });
  const deps = (over: Partial<DraftDeps> = {}): DraftDeps => ({
    loadDocument: async () => usable,
    ask: async () => reply(),
    ...over,
  });

  it("drafts from the document, with HTML stripped from what the model reads", async () => {
    const ask = jest.fn(async (_o: string, _p: string) => reply());
    expect(await draftAnswerFromDocument("org", "Refunds?", "d1", deps({ ask }))).toBe(
      "Yes, within 30 days.",
    );
    const prompt = ask.mock.calls[0][1];
    expect(prompt).toContain("You can return items within 30 days.");
    expect(prompt).not.toContain("<p>");
  });

  it("is null when the document does not state the fact or the answer is empty", async () => {
    const no = deps({ ask: async () => reply({ states_the_fact: false }) });
    expect(await draftAnswerFromDocument("org", "Refunds?", "d1", no)).toBeNull();
    const empty = deps({ ask: async () => reply({ answer: "  " }) });
    expect(await draftAnswerFromDocument("org", "Refunds?", "d1", empty)).toBeNull();
  });

  it("reads at most the first 10 chunks", async () => {
    const long = other(
      "d2",
      "Long",
      Array.from({ length: 80 }, (_, i) => `Paragraph ${i}. ${"x".repeat(900)}`).join("\n\n"),
    );
    const ask = jest.fn(async (_o: string, _p: string) => reply());
    await draftAnswerFromDocument("org", "q", "d2", deps({ loadDocument: async () => long, ask }));
    expect(ask.mock.calls[0][1].match(/^\[\d+\] Long/gm)).toHaveLength(10);
  });

  it("refuses another organization's document and unusable ones", async () => {
    await expect(
      draftAnswerFromDocument("org", "q", "d1", deps({ loadDocument: async () => null })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const status of [DocumentationStatus.ARCHIVED, DocumentationStatus.ERROR]) {
      await expect(
        draftAnswerFromDocument(
          "org",
          "q",
          "d1",
          deps({ loadDocument: async () => ({ ...usable, status }) as Document }),
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("throws on a model or parse failure instead of saying the document does not answer", async () => {
    await expect(
      draftAnswerFromDocument(
        "org",
        "q",
        "d1",
        deps({
          ask: async () => {
            throw new Error("llm down");
          },
        }),
      ),
    ).rejects.toThrow("llm down");
    await expect(
      draftAnswerFromDocument("org", "q", "d1", deps({ ask: async () => "not json" })),
    ).rejects.toThrow();
  });

  it("the service draft writes nothing", async () => {
    findDocuments.mockResolvedValue([]);
    await expect(draftAnswer("org", "nope", "d1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(documents.create).not.toHaveBeenCalled();
    expect(documents.update).not.toHaveBeenCalled();
    expect(saveAnswerDocument).not.toHaveBeenCalled();
  });
});

describe("getAnswer", () => {
  it("is null with no own answer or when its document is gone", async () => {
    expect(await getAnswer("org", "q1")).toBeNull();
    seed([question({ answerDocumentId: "own1" })]);
    expect(await getAnswer("org", "q1")).toBeNull();
  });

  it("returns plain text and whether it is editable", async () => {
    seed([question({ answerDocumentId: "own1" })]);
    documents.findByIdAndOrganization.mockResolvedValue(own);
    expect(await getAnswer("org", "q1")).toEqual({ text: "Yes, 30 days.", editable: true });
    documents.findByIdAndOrganization.mockResolvedValue(other("own1", "T", "<ul><li>a</li></ul>"));
    expect(await getAnswer("org", "q1")).toEqual({ text: "a", editable: false });
  });
});

describe("remove and undo", () => {
  const three = () => [
    question({ id: "a", text: "A?" }),
    question({ id: "b", text: "B?", playbookId: "p1", check: wrong }),
    question({ id: "c", text: "C?" }),
  ];

  it("records the question and its position, newest first, keeping five", async () => {
    seed(Array.from({ length: 7 }, (_, i) => question({ id: `q${i}`, text: `Q${i}?` })));
    for (let i = 0; i < 7; i++) await removeQuestion("org", `q${i}`);
    const removed = store.current.recentlyRemoved as { question: SetupQuestion; index: number }[];
    expect(removed.map((r) => r.question.id)).toEqual(["q6", "q5", "q4", "q3", "q2"]);
    expect(removed[0].index).toBe(0);
  });

  it("removing a question that is not there records nothing", async () => {
    seed(three());
    await removeQuestion("org", "zzz");
    expect(store.current.recentlyRemoved).toBeUndefined();
  });

  it("restores at the old position with its check and playbook, no recheck, and drops the entry", async () => {
    seed(three());
    await removeQuestion("org", "b");
    await restoreQuestion("org", "b");
    expect(stored().map((q) => q.id)).toEqual(["a", "b", "c"]);
    expect(stored()[1]).toMatchObject({ playbookId: "p1", check: wrong });
    expect(store.current.recentlyRemoved).toEqual([]);
    expect(cheap).not.toHaveBeenCalled();
    expect(startTurns).not.toHaveBeenCalled();
  });

  it("restores at the end when the list got shorter", async () => {
    seed(three());
    await removeQuestion("org", "c");
    await removeQuestion("org", "b");
    await restoreQuestion("org", "c");
    expect(stored().map((q) => q.id)).toEqual(["a", "c"]);
  });

  it("fails when it was never removed, the limit is reached, or the text was added again", async () => {
    seed(three());
    await expect(restoreQuestion("org", "b")).rejects.toMatchObject({ code: "NOT_FOUND" });

    await removeQuestion("org", "b");
    store.current.questions = [
      ...stored(),
      ...Array.from({ length: MAX_QUESTIONS - 2 }, (_, i) =>
        question({ id: `x${i}`, text: `X${i}` }),
      ),
    ];
    await expect(restoreQuestion("org", "b")).rejects.toMatchObject({ code: "BAD_REQUEST" });

    seed(three());
    await removeQuestion("org", "b");
    store.current.questions = [...stored(), question({ id: "n", text: "b?" })];
    await expect(restoreQuestion("org", "b")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((store.current.recentlyRemoved as unknown[]).length).toBe(1);
  });
});

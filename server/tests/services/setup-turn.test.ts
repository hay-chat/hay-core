import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: { query: jest.fn() } }));
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
jest.mock("@server/services/vector-store.service", () => ({ vectorStoreService: {} }));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/web-scraper.service", () => ({ WebScraperService: class {} }));
jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: {},
}));
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: {} }));

const store = { current: {} as Record<string, unknown> };
jest.mock("@server/services/setup/store", () => ({
  readSetup: jest.fn(async () => store.current),
  updateSetup: jest.fn(async (_org: string, change: (c: unknown) => unknown) => {
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
jest.mock("@server/services/setup/answer-document", () => ({
  saveAnswerDocument: (...args: unknown[]) => saveAnswerDocument(...args),
}));
const startTurns = jest.fn();
const readTurn = jest.fn();
jest.mock("@server/services/setup/turn", () => ({
  startTurns: (...args: unknown[]) => startTurns(...args),
  readTurn: (...args: unknown[]) => readTurn(...args),
}));

import {
  addAnswer,
  checkQuestions,
  getBoard,
  needsCheck,
} from "../../services/setup/setup.service";
import { buildRow, type BoardFacts } from "../../services/setup/board";
import { classifyTurn, turnRef } from "../../services/setup/turn-classify";
import type { SetupCheckResult, SetupQuestion } from "@server/types/setup.types";

const done = { state: { state: "done", discovered: 1, processed: 1 }, syncedAt: undefined };
const checkedAt = "2026-11-05T10:00:00.000Z";
const answered: SetupCheckResult = {
  outcome: "answered",
  answer: "30 days.",
  sources: [{ documentId: "d1", title: "Returns" }],
  checkedAt,
};
const pending = { state: "pending", runId: "run1", ref: "setup:q1:abc", startedAt: checkedAt };
const question = (over: Partial<SetupQuestion> = {}): SetupQuestion => ({
  id: "q1",
  text: "Do you offer refunds?",
  source: "custom",
  ...over,
});
const facts = (q: SetupQuestion): BoardFacts => ({
  setup: { toolPluginIds: [], channels: [], questions: [q] },
  site: done as BoardFacts["site"],
  plugins: [],
  playbooks: [],
  hasRealConversations: false,
  channels: [],
});
const rowOf = (q: SetupQuestion) => buildRow(q, facts(q));

beforeEach(() => {
  store.current = { toolPluginIds: [], channels: [], questions: [question()] };
  cheap.mockReset().mockResolvedValue(answered);
  readSiteState.mockReset().mockResolvedValue(done);
  startTurns.mockReset().mockImplementation(async (_org: unknown, qs: unknown) => {
    return new Map((qs as { id: string }[]).map((q) => [q.id, { ...pending, ref: `ref-${q.id}` }]));
  });
  readTurn.mockReset().mockResolvedValue("pending");
  saveAnswerDocument.mockReset().mockResolvedValue({ id: "doc1", title: "My answer" });
  (
    jest.requireMock("@server/database/data-source") as { AppDataSource: { query: jest.Mock } }
  ).AppDataSource.query.mockResolvedValue([]);
});

const stored = () => (store.current.questions as SetupQuestion[])[0];

describe("board rows and the real test turn", () => {
  it("is never Ready before a turn passed: pending and legacy answers read as checking", () => {
    expect(rowOf(question({ check: { ...answered, turn: pending as never } })).status).toBe(
      "checking",
    );
    expect(rowOf(question({ check: answered })).status).toBe("checking");
    expect(rowOf(question({ check: { ...answered, turn: { state: "passed" } } })).status).toBe(
      "ready",
    );
  });

  it("a handed-off turn is missing with handedOff", () => {
    const row = rowOf(
      question({ check: { outcome: "not_answered", sources: [], checkedAt, handedOff: true } }),
    );
    expect(row).toMatchObject({ status: "missing", handedOff: true });
  });

  it("a plain not_answered stays missing without handedOff", () => {
    const row = rowOf(question({ check: { outcome: "not_answered", sources: [], checkedAt } }));
    expect(row.status).toBe("missing");
    expect(row.handedOff).toBeUndefined();
  });

  it("legacy answered checks need a check; pending and passed ones do not", () => {
    expect(needsCheck(question({ check: answered }), done as never)).toBe(true);
    expect(
      needsCheck(question({ check: { ...answered, turn: pending as never } }), done as never),
    ).toBe(false);
    expect(
      needsCheck(question({ check: { ...answered, turn: { state: "passed" } } }), done as never),
    ).toBe(false);
  });
});

describe("classifyTurn", () => {
  it("a reply without a hand-off passes, a hand-off does not, no reply fails", () => {
    expect(classifyTurn({ reply: "30 days.", handedOff: false })).toBe("passed");
    expect(classifyTurn({ reply: "I'll pass you to the team", handedOff: true })).toBe(
      "handed_off",
    );
    expect(classifyTurn({ reply: null, handedOff: false })).toBe("failed");
  });

  it("refs differ when the wording changes", () => {
    expect(turnRef({ id: "q", text: "a" })).not.toBe(turnRef({ id: "q", text: "b" }));
  });
});

describe("checkQuestions", () => {
  it("starts a turn for an answered question and leaves it checking, not ready", async () => {
    const board = await checkQuestions("org");
    expect(startTurns).toHaveBeenCalledTimes(1);
    expect(stored().check?.turn).toMatchObject({ state: "pending" });
    expect(board.rows[0].status).toBe("checking");
    expect(board.readyCount).toBe(0);
  });

  it("not_answered and failed filters cost no turn", async () => {
    cheap.mockResolvedValue({ outcome: "not_answered", sources: [], checkedAt });
    let board = await checkQuestions("org");
    expect(board.rows[0].status).toBe("missing");
    cheap.mockResolvedValue({ outcome: "failed", sources: [], checkedAt });
    board = await checkQuestions("org", ["q1"]);
    expect(board.rows[0].status).toBe("check_failed");
    expect(startTurns).not.toHaveBeenCalled();
  });

  it("platform questions get no turn", async () => {
    store.current = {
      toolPluginIds: [],
      channels: [],
      questions: [question({ id: "p1", needs: "orders" })],
    };
    await checkQuestions("org");
    expect(cheap).not.toHaveBeenCalled();
    expect(startTurns).not.toHaveBeenCalled();
  });

  it("a passed turn makes the row Ready on the next read", async () => {
    await checkQuestions("org");
    readTurn.mockResolvedValue("passed");
    const board = await getBoard("org");
    expect(board.rows[0]).toMatchObject({ status: "ready", answer: "30 days." });
  });

  it("a handed-off turn makes the row missing with handedOff", async () => {
    await checkQuestions("org");
    readTurn.mockResolvedValue("handed_off");
    const board = await getBoard("org");
    expect(board.rows[0]).toMatchObject({ status: "missing", handedOff: true, sources: [] });
    expect(board.upNext).toMatchObject({ kind: "answer", questionId: "q1" });
  });

  it("an errored or timed-out turn is check_failed, never missing", async () => {
    await checkQuestions("org");
    readTurn.mockResolvedValue("failed");
    const board = await getBoard("org");
    expect(board.rows[0].status).toBe("check_failed");
  });

  it("a turn still running keeps the row checking and is not started twice", async () => {
    await checkQuestions("org");
    await checkQuestions("org", ["q1"]);
    expect(startTurns).toHaveBeenCalledTimes(1);
    expect((await getBoard("org")).rows[0].status).toBe("checking");
  });

  it("a lost turn is recovered by a recheck, which tests the question again", async () => {
    await checkQuestions("org");
    readTurn.mockResolvedValue("failed");
    const board = await checkQuestions("org");
    expect(startTurns).toHaveBeenCalledTimes(2);
    expect(board.rows[0].status).toBe("checking");
  });

  it("an old answered check with no turn is checked again and cannot show Ready", async () => {
    store.current = {
      toolPluginIds: [],
      channels: [],
      questions: [question({ check: answered })],
    };
    expect((await getBoard("org")).rows[0].status).toBe("checking");
    await checkQuestions("org");
    expect(startTurns).toHaveBeenCalledTimes(1);
  });

  it("a result for a question reworded meanwhile is dropped, not attached to the new text", async () => {
    await checkQuestions("org");
    store.current = {
      ...store.current,
      questions: [question({ text: "Something else?" })],
    };
    readTurn.mockResolvedValue("passed");
    const board = await getBoard("org");
    expect(board.rows[0].status).toBe("checking");
    expect(stored().check).toBeUndefined();
  });

  it("a run that cannot start fails the row instead of leaving it checking", async () => {
    startTurns.mockRejectedValue(new Error("queue down"));
    const board = await checkQuestions("org");
    expect(board.rows[0].status).toBe("check_failed");
  });
});

describe("addAnswer", () => {
  it("counts the customer's own answer for the filter but still needs a passed turn", async () => {
    cheap.mockResolvedValue({ outcome: "not_answered", sources: [], checkedAt });
    const board = await addAnswer("org", "q1", "Yes, 30 days.");
    expect(startTurns).toHaveBeenCalledTimes(1);
    expect(board.rows[0].status).toBe("checking");
    expect(stored()).toMatchObject({
      answerDocumentId: "doc1",
      check: { outcome: "answered", answer: "Yes, 30 days." },
    });

    readTurn.mockResolvedValue("passed");
    expect((await getBoard("org")).rows[0]).toMatchObject({
      status: "ready",
      sources: [{ documentId: "doc1", own: true }],
    });
  });

  it("a handed-off turn on the customer's own answer is missing with handedOff", async () => {
    cheap.mockResolvedValue({ outcome: "not_answered", sources: [], checkedAt });
    await addAnswer("org", "q1", "Maybe.");
    readTurn.mockResolvedValue("handed_off");
    expect((await getBoard("org")).rows[0]).toMatchObject({ status: "missing", handedOff: true });
    expect(stored().answerDocumentId).toBe("doc1");
  });
});

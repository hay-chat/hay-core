// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { row } from "./fixtures";

vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path: string) => `http://api${path}` }),
}));
vi.mock("@/composables/useToolLabel", () => ({
  useToolLabel: () => ({ getToolLabel: (_plugin: string, tool: string) => `Label of ${tool}` }),
}));
const api = vi.hoisted(() => ({
  getAnswer: vi.fn(),
  draftAnswer: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    setup: { getAnswer: { query: api.getAnswer }, draftAnswer: { mutate: api.draftAnswer } },
    documents: { search: { query: api.search } },
  },
  HayApi: {},
}));

import SetupRow from "../../components/setup/SetupRow.vue";

const baseProps = {
  hasSite: true,
  expanded: true,
  saving: false,
  error: false,
  connectTo: null,
  playbookTo: null,
  canOpenDocuments: true,
};

const shipping = { id: "doc1", title: "Shipping policy" };
const returns = { id: "doc2", title: "Returns" };

/** A ready row with the customer's own answer, based on one document. */
const own = {
  answerDocumentId: "ans1",
  linkedDocuments: [shipping],
  sources: [{ documentId: "ans1", title: "Do you ship?", own: true }],
};

/** A ready row whose answer the check found on two pages of the customer's site. */
const found = {
  answer: "We ship in 3 days.",
  sources: [
    { documentId: "d9", title: "Delivery | Alma" },
    { documentId: "d8", title: "FAQ | Alma" },
  ],
};

const QUESTION = "#setup-question-r1";
const ANSWER = "#setup-answer-r1";
const SEARCH = 'input[aria-label="setup.panel.searchLabel"]';
const panel = "[data-testid=setup-panel]";
const docs = "[data-testid=setup-documents]";

describe("SetupRow card", () => {
  let host: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stubNuxtGlobals();
    host = document.createElement("div");
    document.body.appendChild(host);
    api.getAnswer.mockResolvedValue({ text: "Old answer", editable: true });
    api.search.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    host.remove();
  });

  const mountRow = (
    status: Parameters<typeof row>[0]["status"],
    extra: Partial<Parameters<typeof row>[0]> = {},
    props: Record<string, unknown> = {},
  ) =>
    mountWithStubs(SetupRow, {
      attachTo: host,
      props: {
        row: row({ id: "r1", status, ...extra }),
        displayStatus: status,
        ...baseProps,
        ...props,
      },
    });

  type Wrapper = ReturnType<typeof mountRow>;

  const button = (wrapper: Wrapper, text: string) =>
    wrapper.findAll("button").find((b) => b.text() === text);
  const byTestId = (wrapper: Wrapper, id: string) => wrapper.get(`[data-testid=${id}]`);
  const docTitles = (wrapper: Wrapper) =>
    wrapper
      .get(docs)
      .findAll("li .truncate")
      .map((el) => el.text());

  const search = async (wrapper: Wrapper, text: string) => {
    await wrapper.get(SEARCH).setValue(text);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  };
  const results = (wrapper: Wrapper) =>
    wrapper.findAll("ul[aria-label='setup.panel.resultsLabel'] button");
  const pick = async (wrapper: Wrapper, doc: { id: string; title: string }) => {
    api.search.mockResolvedValue([doc]);
    await search(wrapper, doc.title);
    await results(wrapper)[0].trigger("click");
    await flushPromises();
  };

  describe("the closed card", () => {
    it("names the first document an own answer is based on, and counts the rest", async () => {
      const wrapper = mountRow("ready", own, { expanded: false });
      expect(wrapper.text()).toContain('setup.why.readyLinked {"document":"Shipping policy"}');

      await wrapper.setProps({
        row: row({ id: "r1", status: "ready", ...own, linkedDocuments: [shipping, returns] }),
      });
      expect(wrapper.text()).toContain(
        'setup.why.readyLinkedMoreOne {"document":"Shipping policy","count":1}',
      );
    });

    it("names the first page a found answer is on, and counts the rest", async () => {
      const wrapper = mountRow(
        "ready",
        { ...found, sources: [found.sources[0]] },
        { expanded: false },
      );
      expect(wrapper.text()).toContain('setup.why.readyFound {"source":"Delivery"}');

      await wrapper.setProps({
        row: row({
          id: "r1",
          status: "ready",
          ...found,
          sources: [...found.sources, { documentId: "d7", title: "Terms" }],
        }),
      });
      expect(wrapper.text()).toContain(
        'setup.why.readyFoundMoreOther {"source":"Delivery","count":2}',
      );
    });
  });

  describe("what each state shows", () => {
    it("missing: question, an empty focused answer and the document search", async () => {
      const wrapper = mountRow("missing", {}, { expanded: false });
      await wrapper.setProps({ expanded: true });
      await flushPromises();
      expect(wrapper.get(QUESTION).element).toHaveProperty("value", "Question r1");
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "");
      expect(wrapper.get(docs).text()).toContain("setup.documents.startFrom");
      expect(wrapper.find(SEARCH).exists()).toBe(true);
      expect(document.activeElement).toBe(wrapper.get(ANSWER).element);
      expect(api.getAnswer).not.toHaveBeenCalled();
    });

    it("check failed reads like missing", () => {
      const wrapper = mountRow("check_failed");
      expect(wrapper.find(ANSWER).exists()).toBe(true);
      expect(wrapper.find(SEARCH).exists()).toBe(true);
    });

    it("ready with its own answer shows it read-only, with its documents, and focuses the question", async () => {
      const wrapper = mountRow("ready", own, { expanded: false });
      await wrapper.setProps({ expanded: true });
      expect(wrapper.find("[role=status]").exists()).toBe(true);
      await flushPromises();
      expect(api.getAnswer).toHaveBeenCalledWith({ questionId: "r1" });
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(byTestId(wrapper, "setup-answer").text()).toContain("Old answer");
      expect(wrapper.get(docs).text()).toContain('setup.documents.basedOnOne {"count":1}');
      expect(docTitles(wrapper)).toEqual(["Shipping policy"]);
      expect(wrapper.find(SEARCH).exists()).toBe(false);
      expect(document.activeElement).toBe(wrapper.get(QUESTION).element);
    });

    it("ready on pages of the site shows the answer and every page it was found on", () => {
      const wrapper = mountRow("ready", found);
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(byTestId(wrapper, "setup-answer").text()).toContain("We ship in 3 days.");
      expect(wrapper.get(docs).text()).toContain('setup.documents.basedOnOther {"count":2}');
      expect(docTitles(wrapper)).toEqual(["Delivery", "FAQ"]);
    });

    it("an answer that gained formatting is read-only with a link to Knowledge", async () => {
      api.getAnswer.mockResolvedValue({ text: "Formatted", editable: false });
      const wrapper = mountRow("ready", own);
      await flushPromises();
      expect(wrapper.text()).toContain("Formatted");
      expect(wrapper.text()).toContain("setup.panel.formatted");
      expect(wrapper.find("[data-testid=setup-edit-answer]").exists()).toBe(false);
      expect(wrapper.get("a").attributes("href")).toBe("/documents/ans1");

      await wrapper.setProps({ canOpenDocuments: false });
      expect(wrapper.find("a").exists()).toBe(false);
    });

    it("a failed read of the answer says so and can retry", async () => {
      api.getAnswer.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountRow("ready", own);
      await flushPromises();
      expect(wrapper.text()).toContain("setup.panel.answerLoadError");
      expect(wrapper.find("[data-testid=setup-edit-answer]").exists()).toBe(false);
      await button(wrapper, "setup.action.retry")!.trigger("click");
      await flushPromises();
      expect(byTestId(wrapper, "setup-answer").text()).toContain("Old answer");
    });

    it("playbook off keeps Turn on as primary and saves a changed question in place", async () => {
      const wrapper = mountRow("playbook_off", {
        playbook: {
          id: "p1",
          title: "Order status",
          steps: [[{ type: "text", text: "Look it up" }]],
        },
      });
      expect(wrapper.findAll("[data-testid=setup-step]")).toHaveLength(1);
      expect(wrapper.find("[data-testid=setup-save-question]").exists()).toBe(false);
      await button(wrapper, "setup.playbook.turnOn")!.trigger("click");
      expect(wrapper.emitted("turnOn")).toHaveLength(1);

      await wrapper.get(QUESTION).setValue("Where is my order?");
      await byTestId(wrapper, "setup-save-question").trigger("click");
      expect(wrapper.emitted("save")).toEqual([
        [{ text: "Where is my order?" }, { keepOpen: true }],
      ]);
    });

    it("platform and in-progress rows show the question only", () => {
      for (const status of ["needs_connection", "playbook_missing", "checking"] as const) {
        const wrapper = mountRow(status);
        expect(wrapper.find(QUESTION).exists()).toBe(true);
        expect(wrapper.find("textarea").exists()).toBe(false);
        expect(wrapper.find(docs).exists()).toBe(false);
      }
    });

    it("Remove question asks the board to remove the row", async () => {
      const wrapper = mountRow("missing");
      await button(wrapper, "setup.panel.removeQuestion")!.trigger("click");
      expect(wrapper.emitted("remove")).toHaveLength(1);
    });

    it("names its icon-only chevron in its label and tooltip", () => {
      const wrapper = mountRow("ready", own);
      const chevron = wrapper.get('[data-row-action="edit"]');
      expect(chevron.attributes("aria-label")).toContain("Question r1");
      expect(wrapper.get("[role=tooltip]").text()).toBe("setup.action.collapse");
    });
  });

  describe("editing one section in place", () => {
    it("Edit answer turns only the answer into a field; the documents stay as they are", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await byTestId(wrapper, "setup-edit-answer").trigger("click");
      await flushPromises();
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Old answer");
      expect(document.activeElement).toBe(wrapper.get(ANSWER).element);
      expect(docTitles(wrapper)).toEqual(["Shipping policy"]);
      expect(wrapper.find("[data-testid=setup-document-remove]").exists()).toBe(false);
      expect(byTestId(wrapper, "setup-edit-documents").attributes("disabled")).toBeDefined();

      const save = () => byTestId(wrapper, "setup-save-answer");
      expect(save().attributes("disabled")).toBeDefined();
      await wrapper.get(ANSWER).setValue("   ");
      expect(save().attributes("disabled")).toBeDefined();
      await wrapper.get(ANSWER).setValue("New answer");
      await save().trigger("click");
      expect(wrapper.emitted("save")).toEqual([[{ answer: "New answer" }, { keepOpen: true }]]);
    });

    it("Cancel and Escape put the answer back without closing the card", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await byTestId(wrapper, "setup-edit-answer").trigger("click");
      await wrapper.get(ANSWER).setValue("Changed my mind");
      await button(wrapper, "setup.answer.cancel")!.trigger("click");
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(byTestId(wrapper, "setup-answer").text()).toContain("Old answer");

      await byTestId(wrapper, "setup-edit-answer").trigger("click");
      await wrapper.get(panel).trigger("keydown.esc");
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(wrapper.emitted("toggle")).toBeUndefined();
    });

    it("editing a found answer makes it the customer's own, based on the pages it was on", async () => {
      const wrapper = mountRow("ready", found);
      await byTestId(wrapper, "setup-edit-answer").trigger("click");
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "We ship in 3 days.");
      await wrapper.get(ANSWER).setValue("We ship in 2 days.");
      await byTestId(wrapper, "setup-save-answer").trigger("click");
      expect(wrapper.emitted("save")).toEqual([
        [{ answer: "We ship in 2 days.", linkedDocumentIds: ["d9", "d8"] }, { keepOpen: true }],
      ]);
    });

    it("Edit documents edits only the list: remove and add, then Done saves the new list", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await byTestId(wrapper, "setup-edit-documents").trigger("click");
      await flushPromises();
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(document.activeElement).toBe(wrapper.get(SEARCH).element);
      const done = () => byTestId(wrapper, "setup-save-documents");
      expect(done().attributes("disabled")).toBeDefined();

      await pick(wrapper, returns);
      expect(docTitles(wrapper)).toEqual(["Shipping policy", "Returns"]);
      expect(wrapper.get(SEARCH).element).toHaveProperty("value", "");
      await wrapper
        .findAll("[data-testid=setup-document-remove]")
        .find((b) => b.attributes("aria-label")?.includes("Shipping policy"))!
        .trigger("click");
      expect(docTitles(wrapper)).toEqual(["Returns"]);
      await done().trigger("click");
      expect(api.draftAnswer).not.toHaveBeenCalled();
      expect(wrapper.emitted("save")).toEqual([
        [{ linkedDocumentIds: ["doc2"] }, { keepOpen: true }],
      ]);
    });

    it("the search hides the own answer and the documents already listed, five at most", async () => {
      api.search.mockResolvedValue(
        ["ans1", "doc1", "a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: `Doc ${id}` })),
      );
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await byTestId(wrapper, "setup-edit-documents").trigger("click");
      await search(wrapper, "doc");
      expect(results(wrapper).map((b) => b.text())).toEqual([
        "Doc a",
        "Doc b",
        "Doc c",
        "Doc d",
        "Doc e",
      ]);
      expect(api.search).toHaveBeenCalledWith({ query: "doc", limit: 7 });
    });

    it("Done on a found answer redrafts it from the chosen documents and saves it as theirs", async () => {
      api.draftAnswer.mockResolvedValue({ answer: "Drafted from both." });
      const wrapper = mountRow("ready", found);
      await byTestId(wrapper, "setup-edit-documents").trigger("click");
      await pick(wrapper, shipping);
      await byTestId(wrapper, "setup-save-documents").trigger("click");
      await flushPromises();
      expect(api.draftAnswer).toHaveBeenCalledWith({
        questionId: "r1",
        documentIds: ["d9", "d8", "doc1"],
      });
      expect(wrapper.emitted("save")).toEqual([
        [
          { answer: "Drafted from both.", linkedDocumentIds: ["d9", "d8", "doc1"] },
          { keepOpen: true },
        ],
      ]);
    });

    it("Done on a found answer says so when the documents don't answer, and saves nothing", async () => {
      api.draftAnswer.mockResolvedValue({ answer: null });
      const wrapper = mountRow("ready", found);
      await byTestId(wrapper, "setup-edit-documents").trigger("click");
      await byTestId(wrapper, "setup-save-documents").trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain('setup.panel.noAnswerOther {"count":2}');
      expect(wrapper.emitted("save")).toBeUndefined();

      for (const remove of wrapper.findAll("[data-testid=setup-document-remove]")) {
        await remove.trigger("click");
      }
      expect(byTestId(wrapper, "setup-save-documents").attributes("disabled")).toBeDefined();
    });

    it("a saved section goes back to reading once the save went through", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await byTestId(wrapper, "setup-edit-answer").trigger("click");
      await wrapper.get(ANSWER).setValue("New answer");
      await byTestId(wrapper, "setup-save-answer").trigger("click");
      await wrapper.setProps({ saving: true });
      await wrapper.setProps({ saving: false });
      await flushPromises();
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(wrapper.find(panel).exists()).toBe(true);
    });
  });

  describe("writing a new answer", () => {
    it("is disabled until there is an answer, and sends what changed", async () => {
      const wrapper = mountRow("missing");
      const save = () => button(wrapper, "setup.answer.saveAnswer")!;
      expect(save().attributes("disabled")).toBeDefined();

      await wrapper.get(QUESTION).setValue("  Do you ship abroad?  ");
      expect(save().attributes("disabled")).toBeDefined();
      await wrapper.get(ANSWER).setValue("  Yes.  ");
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([
        [{ answer: "Yes.", text: "Do you ship abroad?" }, { keepOpen: false }],
      ]);
    });

    it("clears the draft after a save that ended without an error", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(ANSWER).setValue("Yes.");
      await wrapper.setProps({ saving: true });
      await wrapper.setProps({ saving: false });
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "");
    });

    it("keeps the draft and says so when the save failed", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(ANSWER).setValue("Yes.");
      await wrapper.setProps({ saving: true });
      await wrapper.setProps({ saving: false, error: true });
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Yes.");
      expect(wrapper.text()).toContain("setup.answer.error");
    });
  });

  describe("drafting from documents", () => {
    it("drafts from every document picked, and links them all", async () => {
      api.draftAnswer
        .mockResolvedValueOnce({ answer: "From shipping." })
        .mockResolvedValueOnce({ answer: "From both." });
      const wrapper = mountRow("missing");
      await pick(wrapper, shipping);
      expect(api.draftAnswer).toHaveBeenLastCalledWith({ questionId: "r1", documentIds: ["doc1"] });
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "From shipping.");

      await pick(wrapper, returns);
      expect(api.draftAnswer).toHaveBeenLastCalledWith({
        questionId: "r1",
        documentIds: ["doc1", "doc2"],
      });
      // An untouched draft is replaced by the newer one.
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "From both.");
      expect(wrapper.get(docs).text()).toContain('setup.documents.draftingFromOther {"count":2}');

      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([
        [{ answer: "From both.", linkedDocumentIds: ["doc1", "doc2"] }, { keepOpen: false }],
      ]);
    });

    it("says Drafting while it waits, naming one document or counting several", async () => {
      let finish: (value: { answer: string }) => void = () => {};
      api.draftAnswer.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const wrapper = mountRow("missing");
      await pick(wrapper, shipping);
      expect(wrapper.text()).toContain('setup.panel.draftingOne {"document":"Shipping policy"}');
      finish({ answer: "Done." });
      await flushPromises();
      expect(wrapper.text()).not.toContain("setup.panel.drafting");

      api.draftAnswer.mockReturnValue(new Promise(() => {}));
      await pick(wrapper, returns);
      expect(wrapper.text()).toContain('setup.panel.draftingOther {"count":2}');
    });

    it("keeps text the person typed and only replaces it on request", async () => {
      api.draftAnswer.mockResolvedValue({ answer: "Drafted." });
      const wrapper = mountRow("missing");
      await wrapper.get(ANSWER).setValue("Mine.");
      await pick(wrapper, shipping);
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Mine.");
      await button(wrapper, "setup.panel.replaceDraft")!.trigger("click");
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Drafted.");
      expect(button(wrapper, "setup.panel.replaceDraft")).toBeUndefined();
    });

    it("removing a document takes it off the list without drafting again", async () => {
      api.draftAnswer.mockResolvedValue({ answer: "Drafted." });
      const wrapper = mountRow("missing");
      await pick(wrapper, shipping);
      await wrapper.get("[data-testid=setup-document-remove]").trigger("click");
      expect(wrapper.get(docs).text()).toContain("setup.documents.startFrom");
      expect(api.draftAnswer).toHaveBeenCalledTimes(1);
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Drafted.");
    });

    it("says when the documents don't answer, and when drafting failed", async () => {
      api.draftAnswer.mockResolvedValue({ answer: null });
      const wrapper = mountRow("missing");
      await pick(wrapper, shipping);
      expect(wrapper.text()).toContain('setup.panel.noAnswerOne {"document":"Shipping policy"}');
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "");

      api.draftAnswer.mockRejectedValue(new Error("boom"));
      await pick(wrapper, returns);
      expect(wrapper.text()).toContain("setup.panel.draftError");
      expect(wrapper.text()).not.toContain("setup.panel.noAnswer");
    });

    it("ignores a draft that comes back after Cancel", async () => {
      let finish: (value: { answer: string }) => void = () => {};
      api.draftAnswer.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const wrapper = mountRow("missing");
      await pick(wrapper, shipping);
      await button(wrapper, "setup.answer.cancel")!.trigger("click");
      finish({ answer: "Late." });
      await flushPromises();
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "");
    });
  });

  describe("the draft belongs to the row", () => {
    it("survives closing and a board poll, and is dropped by Cancel", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(QUESTION).setValue("Do you ship abroad?");
      await wrapper.get(ANSWER).setValue("Typed answer");

      await wrapper.setProps({ expanded: false });
      expect(wrapper.find(panel).exists()).toBe(false);
      // A poll replaces the row object.
      await wrapper.setProps({ row: row({ id: "r1", status: "missing" }) });
      await wrapper.setProps({ expanded: true });
      await flushPromises();
      expect(wrapper.get(QUESTION).element).toHaveProperty("value", "Do you ship abroad?");
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Typed answer");

      await button(wrapper, "setup.answer.cancel")!.trigger("click");
      expect(wrapper.emitted("toggle")).toHaveLength(1);
      await wrapper.setProps({ expanded: false });
      await wrapper.setProps({ expanded: true });
      await flushPromises();
      expect(wrapper.get(QUESTION).element).toHaveProperty("value", "Question r1");
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "");
    });

    it("a poll while open does not refetch or overwrite what is being typed", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await byTestId(wrapper, "setup-edit-answer").trigger("click");
      await wrapper.get(ANSWER).setValue("Half-typed");
      await wrapper.setProps({ row: row({ id: "r1", status: "ready", ...own }) });
      await flushPromises();
      expect(wrapper.get(ANSWER).element).toHaveProperty("value", "Half-typed");
      expect(api.getAnswer).toHaveBeenCalledTimes(1);
    });

    it("Escape closes a clean card and leaves a changed one open", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(panel).trigger("keydown.esc");
      expect(wrapper.emitted("toggle")).toHaveLength(1);

      await wrapper.get(ANSWER).setValue("Unsaved");
      await wrapper.get(panel).trigger("keydown.esc");
      expect(wrapper.emitted("toggle")).toHaveLength(1);
    });

    it("hands focus back to the chevron when it closes", async () => {
      const wrapper = mountRow("missing");
      await flushPromises();
      (document.activeElement as HTMLElement | null)?.blur();
      await wrapper.setProps({ expanded: false });
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[data-row-action="edit"]').element);
    });
  });

  describe("document search", () => {
    it("waits for two characters and 300 ms, then searches", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(SEARCH).setValue("s");
      await vi.advanceTimersByTimeAsync(400);
      expect(api.search).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("setup.panel.searchHint");

      await wrapper.get(SEARCH).setValue("sh");
      await vi.advanceTimersByTimeAsync(299);
      expect(api.search).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("setup.panel.searching");
      await vi.advanceTimersByTimeAsync(1);
      expect(api.search).toHaveBeenCalledTimes(1);
      expect(api.search.mock.calls[0][0].query).toBe("sh");
    });

    it("says when nothing matches and when the search fails", async () => {
      const wrapper = mountRow("missing");
      await search(wrapper, "zzz");
      expect(wrapper.text()).toContain('setup.panel.noResults {"query":"zzz"}');

      api.search.mockRejectedValueOnce(new Error("offline"));
      await search(wrapper, "zzzz");
      expect(wrapper.find("[role=alert]").text()).toContain("setup.panel.searchError");
    });

    it("drops an older search that answers after a newer one", async () => {
      let first: (value: unknown) => void = () => {};
      api.search.mockReturnValueOnce(new Promise((resolve) => (first = resolve)));
      api.search.mockResolvedValueOnce([{ id: "n", title: "Newer" }]);
      const wrapper = mountRow("missing");
      await search(wrapper, "old");
      await search(wrapper, "newer");
      first([{ id: "o", title: "Older" }]);
      await flushPromises();
      expect(results(wrapper).map((b) => b.text())).toEqual(["Newer"]);
    });

    it("does not search after the panel unmounts", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(SEARCH).setValue("sh");
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(1000);
      expect(api.search).not.toHaveBeenCalled();
    });
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { row } from "./fixtures";

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

const own = {
  answerDocumentId: "ans1",
  linkedDocument: { id: "doc1", title: "Shipping policy" },
  sources: [{ documentId: "ans1", title: "Do you ship?", own: true }],
};

const QUESTION = 'input[aria-label="setup.panel.questionLabel"]';
const SEARCH = 'input[aria-label="setup.panel.searchLabel"]';
const panel = "[data-testid=setup-panel]";

describe("SetupRow edit panel", () => {
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

  const button = (wrapper: ReturnType<typeof mountRow>, text: string) =>
    wrapper.findAll("button").find((b) => b.text() === text);

  const search = async (wrapper: ReturnType<typeof mountRow>, text: string) => {
    await wrapper.get(SEARCH).setValue(text);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
  };

  const results = (wrapper: ReturnType<typeof mountRow>) =>
    wrapper.findAll("ul[aria-label='setup.panel.resultsLabel'] button");

  describe("what each state shows", () => {
    it("missing: question, an empty focused answer and the document search", async () => {
      const wrapper = mountRow("missing", {}, { expanded: false });
      await wrapper.setProps({ expanded: true });
      await flushPromises();
      expect(wrapper.get(QUESTION).element).toHaveProperty("value", "Question r1");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "");
      expect(wrapper.find(SEARCH).exists()).toBe(true);
      expect(document.activeElement).toBe(wrapper.get("textarea").element);
      expect(api.getAnswer).not.toHaveBeenCalled();
    });

    it("check failed reads like missing", () => {
      const wrapper = mountRow("check_failed");
      expect(wrapper.find("textarea").exists()).toBe(true);
      expect(wrapper.find(SEARCH).exists()).toBe(true);
    });

    it("ready with its own answer loads it, shows the document and focuses the question", async () => {
      const wrapper = mountRow("ready", own, { expanded: false });
      await wrapper.setProps({ expanded: true });
      expect(wrapper.find("[role=status]").exists()).toBe(true);
      await flushPromises();
      expect(api.getAnswer).toHaveBeenCalledWith({ questionId: "r1" });
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Old answer");
      expect(wrapper.text()).toContain('setup.panel.basedOn {"document":"Shipping policy"}');
      expect(wrapper.find(SEARCH).exists()).toBe(false);
      expect(document.activeElement).toBe(wrapper.get(QUESTION).element);
    });

    it("a linked ready row reads Your answer, based on the document", () => {
      const wrapper = mountRow("ready", own, { expanded: false });
      expect(wrapper.text()).toContain('setup.why.readyLinked {"document":"Shipping policy"}');
    });

    it("ready on a page shows the found answer read-only until the person takes over", async () => {
      const wrapper = mountRow("ready", {
        answer: "We ship in 3 days.",
        sources: [{ documentId: "d9", title: "Delivery | Alma" }],
      });
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(wrapper.text()).toContain("We ship in 3 days.");
      expect(wrapper.get("[data-testid=setup-found]").text()).toContain(
        'setup.why.readyFound {"source":"Delivery"}',
      );

      await button(wrapper, "setup.panel.writeMyOwn")!.trigger("click");
      await flushPromises();
      expect(wrapper.get("textarea").element).toHaveProperty("value", "");
      expect(document.activeElement).toBe(wrapper.get("textarea").element);
    });

    it("Change document on a found answer opens the search", async () => {
      const wrapper = mountRow("ready", { sources: [{ documentId: "d9", title: "Delivery" }] });
      await button(wrapper, "setup.panel.changeDocument")!.trigger("click");
      await flushPromises();
      expect(wrapper.find("textarea").exists()).toBe(true);
      expect(document.activeElement).toBe(wrapper.get(SEARCH).element);
    });

    it("an answer that gained formatting is read-only with a link to Knowledge", async () => {
      api.getAnswer.mockResolvedValue({ text: "Formatted", editable: false });
      const wrapper = mountRow("ready", own);
      await flushPromises();
      expect(wrapper.find("textarea").exists()).toBe(false);
      expect(wrapper.get("[data-testid=setup-readonly-answer]").text()).toContain("Formatted");
      expect(wrapper.get("a").attributes("href")).toBe("/documents/ans1");

      await wrapper.setProps({ canOpenDocuments: false });
      expect(wrapper.find("a").exists()).toBe(false);
    });

    it("a failed read of the answer says so and can retry, never offering an empty field", async () => {
      api.getAnswer.mockRejectedValueOnce(new Error("offline"));
      const wrapper = mountRow("ready", own);
      await flushPromises();
      expect(wrapper.text()).toContain("setup.panel.answerLoadError");
      expect(wrapper.find("textarea").exists()).toBe(false);
      await button(wrapper, "setup.action.retry")!.trigger("click");
      await flushPromises();
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Old answer");
    });

    it("playbook off keeps Turn on as primary and offers Save only after the question changes", async () => {
      const wrapper = mountRow("playbook_off", {
        playbook: { id: "p1", title: "Order status", steps: ["Look it up"] },
      });
      expect(wrapper.findAll("ol li")).toHaveLength(1);
      expect(button(wrapper, "setup.answer.save")).toBeUndefined();
      await button(wrapper, "setup.playbook.turnOn")!.trigger("click");
      expect(wrapper.emitted("turnOn")).toHaveLength(1);

      await wrapper.get(QUESTION).setValue("Where is my order?");
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([[{ text: "Where is my order?" }]]);
    });

    it("platform and in-progress rows show the question only", () => {
      for (const status of ["needs_connection", "playbook_missing", "checking"] as const) {
        const wrapper = mountRow(status);
        expect(wrapper.find(QUESTION).exists()).toBe(true);
        expect(wrapper.find("textarea").exists()).toBe(false);
        expect(wrapper.find(SEARCH).exists()).toBe(false);
      }
    });

    it("Remove question asks the board to remove the row", async () => {
      const wrapper = mountRow("missing");
      await button(wrapper, "setup.panel.removeQuestion")!.trigger("click");
      expect(wrapper.emitted("remove")).toHaveLength(1);
    });
  });

  describe("saving", () => {
    it("is disabled with no change and sends only what changed", async () => {
      const wrapper = mountRow("missing");
      const save = () => button(wrapper, "setup.answer.save")!;
      expect(save().attributes("disabled")).toBeDefined();

      await wrapper.get(QUESTION).setValue("  Do you ship abroad?  ");
      expect(save().attributes("disabled")).toBeUndefined();
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([[{ text: "Do you ship abroad?" }]]);

      await wrapper.get("textarea").setValue("Yes.");
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")?.[1]).toEqual([
        { text: "Do you ship abroad?", answer: "Yes." },
      ]);
    });

    it("does not allow emptying an existing answer", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await wrapper.get("textarea").setValue("   ");
      expect(button(wrapper, "setup.answer.save")!.attributes("disabled")).toBeDefined();
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toBeUndefined();
    });

    it("an unchanged question text is not sent when only the answer changes", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await wrapper.get("textarea").setValue("New answer");
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([[{ answer: "New answer" }]]);
    });

    it("clears the draft after a save that ended without an error", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get("textarea").setValue("Yes.");
      await wrapper.setProps({ saving: true });
      await wrapper.setProps({ saving: false });
      expect(wrapper.get("textarea").element).toHaveProperty("value", "");
    });

    it("keeps the draft and says so when the save failed", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get("textarea").setValue("Yes.");
      await wrapper.setProps({ saving: true });
      await wrapper.setProps({ saving: false, error: true });
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Yes.");
      expect(wrapper.text()).toContain("setup.answer.error");
    });
  });

  describe("the draft belongs to the row", () => {
    it("survives closing and a board poll, and is dropped by Cancel", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await wrapper.get(QUESTION).setValue("Do you ship abroad?");
      await wrapper.get("textarea").setValue("Typed answer");

      await wrapper.setProps({ expanded: false });
      expect(wrapper.find(panel).exists()).toBe(false);
      // A poll replaces the row object.
      await wrapper.setProps({ row: row({ id: "r1", status: "ready", ...own }) });
      await wrapper.setProps({ expanded: true });
      await flushPromises();
      expect(wrapper.get(QUESTION).element).toHaveProperty("value", "Do you ship abroad?");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Typed answer");
      expect(api.getAnswer).toHaveBeenCalledTimes(1);

      await button(wrapper, "setup.answer.cancel")!.trigger("click");
      expect(wrapper.emitted("toggle")).toHaveLength(1);
      await wrapper.setProps({ expanded: false });
      await wrapper.setProps({ expanded: true });
      await flushPromises();
      expect(wrapper.get(QUESTION).element).toHaveProperty("value", "Question r1");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Old answer");
    });

    it("a poll while open does not refetch or overwrite what is being typed", async () => {
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await wrapper.get("textarea").setValue("Half-typed");
      await wrapper.setProps({ row: row({ id: "r1", status: "ready", ...own }) });
      await flushPromises();
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Half-typed");
      expect(api.getAnswer).toHaveBeenCalledTimes(1);
    });

    it("Escape closes a clean panel and leaves a changed one open", async () => {
      const wrapper = mountRow("missing");
      await wrapper.get(panel).trigger("keydown.esc");
      expect(wrapper.emitted("toggle")).toHaveLength(1);

      await wrapper.get("textarea").setValue("Unsaved");
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

  describe("drafting from a document", () => {
    const pick = async (wrapper: ReturnType<typeof mountRow>, title = "Shipping policy") => {
      api.search.mockResolvedValue([{ id: "doc1", title }]);
      await search(wrapper, "ship");
      await results(wrapper)[0].trigger("click");
      await flushPromises();
    };

    it("fills an empty answer and links the document", async () => {
      api.draftAnswer.mockResolvedValue({ answer: "We ship in 3 days." });
      const wrapper = mountRow("missing");
      await pick(wrapper);
      expect(api.draftAnswer).toHaveBeenCalledWith({ questionId: "r1", documentId: "doc1" });
      expect(wrapper.get("textarea").element).toHaveProperty("value", "We ship in 3 days.");
      expect(wrapper.text()).toContain('setup.panel.basedOn {"document":"Shipping policy"}');
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([
        [{ answer: "We ship in 3 days.", linkedDocumentId: "doc1" }],
      ]);
    });

    it("says Drafting while it waits", async () => {
      let finish: (value: { answer: string }) => void = () => {};
      api.draftAnswer.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const wrapper = mountRow("missing");
      await pick(wrapper);
      expect(wrapper.text()).toContain('setup.panel.drafting {"document":"Shipping policy"}');
      finish({ answer: "Done." });
      await flushPromises();
      expect(wrapper.text()).not.toContain("setup.panel.drafting");
    });

    it("keeps text the person typed and only replaces it on request", async () => {
      api.draftAnswer.mockResolvedValue({ answer: "Drafted." });
      const wrapper = mountRow("missing");
      await wrapper.get("textarea").setValue("Mine.");
      await pick(wrapper);
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Mine.");
      await button(wrapper, "setup.panel.replaceDraft")!.trigger("click");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Drafted.");
      expect(button(wrapper, "setup.panel.replaceDraft")).toBeUndefined();
    });

    it("treats the saved answer as the person's text too", async () => {
      api.draftAnswer.mockResolvedValue({ answer: "Drafted." });
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await button(wrapper, "setup.panel.changeDocument")!.trigger("click");
      await pick(wrapper, "Returns");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Old answer");
      expect(button(wrapper, "setup.panel.replaceDraft")).toBeDefined();
    });

    it("replaces a previous draft they have not edited, but not once edited", async () => {
      api.draftAnswer.mockResolvedValueOnce({ answer: "First draft." });
      const wrapper = mountRow("missing");
      await pick(wrapper);
      api.draftAnswer.mockResolvedValueOnce({ answer: "Second draft." });
      await button(wrapper, "setup.panel.changeDocument")!.trigger("click");
      await pick(wrapper, "Returns");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Second draft.");

      await wrapper.get("textarea").setValue("Second draft, edited.");
      api.draftAnswer.mockResolvedValueOnce({ answer: "Third draft." });
      await button(wrapper, "setup.panel.changeDocument")!.trigger("click");
      await pick(wrapper, "Terms");
      expect(wrapper.get("textarea").element).toHaveProperty("value", "Second draft, edited.");
      expect(button(wrapper, "setup.panel.replaceDraft")).toBeDefined();
    });

    it("says when the document does not answer, and keeps the link", async () => {
      api.draftAnswer.mockResolvedValue({ answer: null });
      const wrapper = mountRow("missing");
      await pick(wrapper);
      expect(wrapper.text()).toContain('setup.panel.noAnswer {"document":"Shipping policy"}');
      expect(wrapper.get("textarea").element).toHaveProperty("value", "");
      await wrapper.get(panel).trigger("submit");
      expect(wrapper.emitted("save")).toEqual([[{ linkedDocumentId: "doc1" }]]);
    });

    it("a failed draft has its own message, apart from not answering", async () => {
      api.draftAnswer.mockRejectedValue(new Error("boom"));
      const wrapper = mountRow("missing");
      await pick(wrapper);
      expect(wrapper.text()).toContain('setup.panel.draftError {"document":"Shipping policy"}');
      expect(wrapper.text()).not.toContain("setup.panel.noAnswer");
    });

    it("ignores a draft that comes back after Cancel", async () => {
      let finish: (value: { answer: string }) => void = () => {};
      api.draftAnswer.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const wrapper = mountRow("missing");
      await pick(wrapper);
      await button(wrapper, "setup.answer.cancel")!.trigger("click");
      finish({ answer: "Late." });
      await flushPromises();
      expect(wrapper.get("textarea").element).toHaveProperty("value", "");
    });
  });

  describe("document search", () => {
    it("waits for two characters and 300 ms, then searches for five", async () => {
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

    it("hides the row's own answer document and shows at most five", async () => {
      api.search.mockResolvedValue(
        ["ans1", "a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: `Doc ${id}` })),
      );
      const wrapper = mountRow("ready", own);
      await flushPromises();
      await button(wrapper, "setup.panel.changeDocument")!.trigger("click");
      await search(wrapper, "doc");
      expect(results(wrapper).map((b) => b.text())).toEqual([
        "Doc a",
        "Doc b",
        "Doc c",
        "Doc d",
        "Doc e",
      ]);
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

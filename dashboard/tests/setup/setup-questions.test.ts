// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals } from "../component-harness";
import { board, row } from "./fixtures";

const api = vi.hoisted(() => ({
  suggestions: vi.fn(),
  infer: vi.fn(),
  saveAnswers: vi.fn(),
}));
vi.mock("@/utils/api", () => ({
  Hay: {
    setup: {
      suggestions: { query: api.suggestions },
      inferBusinessType: { mutate: api.infer },
      saveAnswers: { mutate: api.saveAnswers },
    },
  },
}));

import SetupQuestions from "../../components/setup/SetupQuestions.vue";

const suggestions = {
  questions: [
    { id: "returns", text: "What is your return policy?" },
    { id: "order", text: "Where is my order?", needs: "orders" },
  ],
  plugins: [
    { id: "shopify", name: "Shopify", group: "commerce", handles: ["orders"] },
    { id: "stripe", name: "Stripe", group: "payments", handles: ["billing"] },
  ],
  channels: [{ id: "webchat", name: "Website chat" }],
};

const fresh = board({
  rows: [],
  answeredAt: undefined,
  businessType: undefined,
  website: "",
  toolPluginIds: [],
  channels: [],
});

const mountQuestions = (props: Record<string, unknown> = {}) =>
  mountWithStubs(SetupQuestions, { props: { board: fresh, editing: false, ...props } });

const buttonByText = (wrapper: ReturnType<typeof mountQuestions>, text: string) =>
  wrapper.findAll("button").find((b) => b.text() === text)!;

describe("SetupQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubNuxtGlobals();
    api.suggestions.mockResolvedValue(suggestions);
    api.infer.mockResolvedValue({ businessType: null });
    api.saveAnswers.mockResolvedValue(
      board({ rows: [row({ id: "returns", status: "checking" })] }),
    );
  });

  it("preselects and labels the type only when the site read returns one", async () => {
    api.infer.mockResolvedValueOnce({ businessType: "saas" });
    const wrapper = mountQuestions({ board: { ...fresh, website: "alma.example" } });
    await flushPromises();

    expect(api.infer).toHaveBeenCalledWith({ website: "alma.example" });
    expect(wrapper.get<HTMLInputElement>('input[value="saas"]').element.checked).toBe(true);
    expect(wrapper.text()).toContain("setup.questions.type.inferred");
  });

  it("preselects nothing when the site can't be read", async () => {
    const wrapper = mountQuestions({ board: { ...fresh, website: "alma.example" } });
    await flushPromises();

    const checked = wrapper
      .findAll<HTMLInputElement>('input[type="radio"]')
      .filter((r) => r.element.checked);
    expect(checked).toHaveLength(0);
    expect(wrapper.text()).not.toContain("setup.questions.type.inferred");
    const next = buttonByText(wrapper, "setup.questions.continue");
    expect(next.attributes("disabled")).toBeDefined();
  });

  it("never overrides a type the person already chose", async () => {
    let resolve: (value: { businessType: "saas" }) => void = () => {};
    api.infer.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const wrapper = mountQuestions({ board: { ...fresh, website: "alma.example" } });
    await wrapper.get('input[value="service"]').setValue(true);
    resolve({ businessType: "saas" });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[value="service"]').element.checked).toBe(true);
    expect(wrapper.get<HTMLInputElement>('input[value="saas"]').element.checked).toBe(false);
  });

  it("keeps draft answers when going back and forth, then saves them", async () => {
    const wrapper = mountQuestions();
    await wrapper.get('input[value="store"]').setValue(true);
    await flushPromises();
    await buttonByText(wrapper, "setup.questions.continue").trigger("click");

    // Step 2: groups come from the suggestions, never from hardcoded names.
    expect(wrapper.text()).toContain("setup.groups.commerce");
    expect(wrapper.text()).toContain("setup.groups.payments");
    const shopify = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[0];
    await shopify.setValue(true);
    await buttonByText(wrapper, "setup.questions.continue").trigger("click");

    // Step 3: drop one suggestion, add one of our own.
    const boxes = () => wrapper.findAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes().map((b) => b.element.checked)).toEqual([true, true]);
    await boxes()[1].setValue(false);
    await wrapper
      .get('input[aria-label="setup.questions.ask.addLabel"]')
      .setValue("Do you gift wrap?");
    await wrapper.findAll("form")[0].trigger("submit");
    expect(boxes()).toHaveLength(3);
    // The live list follows the selection, with the chosen platform as the tag.
    expect(wrapper.get('[aria-label="setup.live.label"]').text()).toContain("Do you gift wrap?");
    expect(wrapper.get('[aria-label="setup.live.label"]').text()).not.toContain(
      "Where is my order?",
    );

    // Back twice, then forward again: nothing was lost.
    await buttonByText(wrapper, "setup.questions.back").trigger("click");
    expect(wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')[0].element.checked).toBe(
      true,
    );
    await buttonByText(wrapper, "setup.questions.back").trigger("click");
    expect(wrapper.get<HTMLInputElement>('input[value="store"]').element.checked).toBe(true);
    await buttonByText(wrapper, "setup.questions.continue").trigger("click");
    await buttonByText(wrapper, "setup.questions.continue").trigger("click");
    expect(boxes().map((b) => b.element.checked)).toEqual([true, false, true]);

    await buttonByText(wrapper, "setup.questions.finish").trigger("click");
    await flushPromises();
    expect(api.saveAnswers).toHaveBeenCalledWith({
      businessType: "store",
      website: undefined,
      toolPluginIds: ["shopify"],
      channels: [],
      questions: [
        { id: "returns", text: "What is your return policy?" },
        { id: undefined, text: "Do you gift wrap?" },
      ],
    });
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("skip saves the suggested defaults without walking the steps", async () => {
    const wrapper = mountQuestions();
    await wrapper.get('input[value="store"]').setValue(true);
    await flushPromises();
    await buttonByText(wrapper, "setup.questions.skip").trigger("click");
    await flushPromises();

    expect(api.saveAnswers).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "store",
        questions: [
          { id: "returns", text: "What is your return policy?" },
          { id: "order", text: "Where is my order?" },
        ],
      }),
    );
  });

  it("skip works before any type is chosen", async () => {
    const wrapper = mountQuestions();
    await buttonByText(wrapper, "setup.questions.skip").trigger("click");
    await flushPromises();
    expect(api.saveAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ businessType: "other" }),
    );
  });

  it("shows a retry when the answers can't be saved, keeping the draft", async () => {
    api.saveAnswers.mockRejectedValueOnce(new Error("offline"));
    const wrapper = mountQuestions();
    await wrapper.get('input[value="store"]').setValue(true);
    await flushPromises();
    await buttonByText(wrapper, "setup.questions.skip").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("setup.questions.saveError");
    expect(wrapper.emitted("saved")).toBeUndefined();
    expect(wrapper.get<HTMLInputElement>('input[value="store"]').element.checked).toBe(true);
  });

  it("when editing, starts from the saved answers and leaves without saving", async () => {
    const saved = board({
      rows: [
        row({ id: "returns", status: "ready" }),
        row({ id: "mine", status: "missing", source: "custom", text: "Can I pay in instalments?" }),
      ],
      toolPluginIds: ["shopify"],
      channels: ["webchat"],
    });
    const wrapper = mountQuestions({ board: saved, editing: true, startStep: 2 });
    await flushPromises();

    const labels = wrapper.findAll("fieldset label").map((l) => l.text());
    expect(labels).toContain("Can I pay in instalments?");
    const boxes = wrapper.findAll<HTMLInputElement>('fieldset input[type="checkbox"]');
    expect(boxes.map((b) => b.element.checked)).toEqual([true, false, true]);

    await buttonByText(wrapper, "setup.questions.backToList").trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(api.saveAnswers).not.toHaveBeenCalled();
  });

  it("shows reading progress from the board's site state in the live list", async () => {
    const wrapper = mountQuestions({
      board: {
        ...fresh,
        website: "https://alma.example",
        site: { state: "reading", discovered: 30, processed: 12 },
      },
    });
    await flushPromises();
    expect(wrapper.get('[aria-label="setup.live.label"]').text()).toContain(
      'setup.live.readingOther {"site":"alma.example","count":12}',
    );
  });
});

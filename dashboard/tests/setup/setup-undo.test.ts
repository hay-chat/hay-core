// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, stubNuxtGlobals, toast as toastMock } from "../component-harness";
import { board, row } from "./fixtures";

vi.mock("@/composables/useDomain", () => ({
  useDomain: () => ({ getApiUrl: (path: string) => `http://api${path}` }),
}));
vi.mock("@/utils/api", () => ({ Hay: {}, HayApi: {} }));
vi.mock("@/utils/route-access", async () => ({
  hasRouteAccess: (await import("./fixtures")).hasRouteAccess,
}));
vi.mock("@/components/setup/SetupTestChat.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "SetupTestChat",
      setup(_, { expose }) {
        expose({ ask: vi.fn(), busy: false });
        return () => h("div");
      },
    }),
  };
});
vi.mock("@/components/setup/SetupReplay.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ name: "SetupReplay", setup: () => () => h("div") }) };
});
vi.mock("@/composables/useWebchatSnippet", async () => {
  const { computed, ref } = await import("vue");
  return {
    useWebchatSnippet: () => ({
      snippet: computed(() => ""),
      loading: ref(false),
      failed: ref(false),
      enabled: ref(true),
      load: vi.fn(),
    }),
  };
});

import SetupBoardView from "../../components/setup/SetupBoard.vue";
import ToastContainer from "../../components/ui/ToastContainer.vue";
import { useToast } from "../../composables/useToast";
import { useUserStore } from "@/stores/user";

const rows = [
  row({ id: "a", status: "ready" }),
  row({ id: "b", status: "missing" }),
  row({ id: "c", status: "ready" }),
];

describe("removing a question and undoing it", () => {
  let host: HTMLElement;
  let wrapper: ReturnType<typeof mountBoard>;

  const actions = {
    addQuestion: vi.fn().mockResolvedValue(true),
    removeQuestion: vi.fn(),
    restoreQuestion: vi.fn(),
    saveRow: vi.fn().mockResolvedValue(true),
    retryRow: vi.fn().mockResolvedValue(undefined),
    turnOnPlaybook: vi.fn().mockResolvedValue(true),
    generatePlaybook: vi.fn().mockResolvedValue(undefined),
    finishLater: vi.fn().mockResolvedValue(true),
  };

  const mountBoard = () =>
    mountWithStubs(SetupBoardView, {
      attachTo: host,
      props: {
        board: board({ rows }),
        checking: false,
        checkFailed: false,
        busyRowIds: [],
        actions,
      },
    });

  const chevron = (id: string) =>
    document.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-row-action="edit"]`);
  const ids = () => wrapper.findAll("[data-row-id]").map((el) => el.attributes("data-row-id"));

  const open = async (id: string) => {
    await wrapper.get(`[data-row-id="${id}"] [data-row-action="edit"]`).trigger("click");
    await flushPromises();
  };
  const removeButton = (id: string) =>
    wrapper
      .get(`[data-row-id="${id}"]`)
      .findAll("button")
      .find((b) => b.text() === "setup.panel.removeQuestion")!;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    useUserStore().$patch({
      activeOrganizationId: "o1",
      organizations: [{ id: "o1", role: "admin" }] as never,
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    actions.removeQuestion.mockImplementation(async (id: string) => {
      await wrapper.setProps({ board: board({ rows: rows.filter((r) => r.id !== id) }) });
      return true;
    });
    actions.restoreQuestion.mockImplementation(async () => {
      await wrapper.setProps({ board: board({ rows }) });
      return true;
    });
    wrapper = mountBoard();
  });
  afterEach(() => {
    wrapper.unmount();
    host.remove();
    vi.unstubAllGlobals();
  });

  it("removes at once, focuses the neighbour's chevron and offers Undo for eight seconds", async () => {
    await open("b");
    await removeButton("b").trigger("click");
    await flushPromises();

    expect(actions.removeQuestion).toHaveBeenCalledWith("b");
    expect(ids()).toEqual(["a", "c"]);
    expect(document.activeElement).toBe(chevron("c"));
    expect(toastMock.show).toHaveBeenCalledTimes(1);
    expect(toastMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "setup.board.removed",
        duration: 8000,
        action: expect.objectContaining({ label: "setup.board.undo" }),
      }),
    );
  });

  it("Undo restores the row and puts focus on its chevron", async () => {
    await open("b");
    await removeButton("b").trigger("click");
    await flushPromises();

    toastMock.show.mock.calls[0][0].action.onClick();
    await flushPromises();

    expect(actions.restoreQuestion).toHaveBeenCalledWith("b");
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(document.activeElement).toBe(chevron("b"));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("says so when Undo fails, and leaves the list alone", async () => {
    await open("b");
    await removeButton("b").trigger("click");
    await flushPromises();
    actions.restoreQuestion.mockResolvedValue(false);

    toastMock.show.mock.calls[0][0].action.onClick();
    await flushPromises();

    expect(toastMock.error).toHaveBeenCalledWith("setup.board.undoError");
    expect(ids()).toEqual(["a", "c"]);
  });

  it("gives each removal its own toast", async () => {
    await open("a");
    await removeButton("a").trigger("click");
    await flushPromises();
    await open("c");
    await removeButton("c").trigger("click");
    await flushPromises();

    expect(toastMock.show).toHaveBeenCalledTimes(2);
    toastMock.show.mock.calls[0][0].action.onClick();
    expect(actions.restoreQuestion).toHaveBeenLastCalledWith("a");
  });

  it("shows no toast and the error when the removal fails", async () => {
    actions.removeQuestion.mockResolvedValue(false);
    await open("b");
    await removeButton("b").trigger("click");
    await flushPromises();
    expect(toastMock.show).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("setup.board.removeError");
  });
});

describe("toasts with an action", () => {
  beforeEach(() => {
    const { toasts } = useToast();
    toasts.value.splice(0);
  });

  it("renders a real button that runs the action and closes the toast", async () => {
    const onClick = vi.fn();
    const { show, toasts } = useToast();
    show({
      type: "info",
      title: "Question removed",
      duration: 0,
      action: { label: "Undo", onClick },
    });

    const wrapper = mountWithStubs(ToastContainer);
    const undo = wrapper.findAll("button").find((b) => b.text() === "Undo")!;
    expect(undo.attributes("type")).toBe("button");
    await undo.trigger("click");

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("toasts without an action render no extra button", () => {
    useToast().show({ type: "success", title: "Saved", duration: 0 });
    const wrapper = mountWithStubs(ToastContainer);
    expect(wrapper.findAll("button")).toHaveLength(1);
  });

  it("two toasts in the same millisecond get different ids", () => {
    vi.useFakeTimers();
    const { show, toasts } = useToast();
    const first = show({ type: "info", title: "One", duration: 0 });
    const second = show({ type: "info", title: "Two", duration: 0 });
    vi.useRealTimers();
    expect(first).not.toBe(second);
    expect(toasts.value.map((t) => t.id)).toEqual([first, second]);
  });
});

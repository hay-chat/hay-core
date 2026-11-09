// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { mountWithStubs, router, stubNuxtGlobals } from "../component-harness";
import { board, row } from "./fixtures";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/utils/api", () => ({ Hay: { setup: { get: { query: api.get } } }, HayApi: {} }));
vi.mock("@/utils/route-access", async () => ({
  hasRouteAccess: (await import("./fixtures")).hasRouteAccess,
}));

import IndexPage from "../../pages/index.vue";
import SetupSidebarWidget from "../../components/setup/SetupSidebarWidget.vue";
import { useSetupStore } from "@/stores/setup";
import { useUserStore } from "@/stores/user";

const signIn = (role: string) =>
  useUserStore().$patch({
    activeOrganizationId: "o1",
    organizations: [{ id: "o1", role }] as never,
  });

describe("home redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    stubNuxtGlobals();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    signIn("owner");
  });

  const open = async () => {
    mountWithStubs(IndexPage);
    await flushPromises();
  };

  it("sends organizations the server wants prompted to setup", async () => {
    api.get.mockResolvedValue(board({ shouldPrompt: true, answeredAt: undefined }));
    await open();
    expect(router.replace).toHaveBeenCalledWith("/setup");
  });

  it("goes to the dashboard when nothing is prompted", async () => {
    api.get.mockResolvedValue(board({ shouldPrompt: false }));
    await open();
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("goes to the inbox on phones", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    api.get.mockResolvedValue(board({ shouldPrompt: false }));
    await open();
    expect(router.replace).toHaveBeenCalledWith("/inbox");
  });

  it("fails open to home when setup can't be read", async () => {
    api.get.mockRejectedValue(new Error("server down"));
    await open();
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
    expect(router.replace).not.toHaveBeenCalledWith("/setup");
  });

  it("never asks the server for roles without access", async () => {
    signIn("contributor");
    await open();
    expect(api.get).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/dashboard");
  });
});

describe("sidebar setup", () => {
  const rows = [row({ id: "a", status: "ready" }), row({ id: "b", status: "missing" })];
  const withRows = board({
    rows,
    upNext: { kind: "answer", questionId: "b", text: "Do you ship to Canada?" },
  });

  const mountWidget = (path = "/dashboard") => {
    vi.stubGlobal("useRoute", () => ({ path }));
    return mountWithStubs(SetupSidebarWidget);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    stubNuxtGlobals();
  });

  it("shows ready count, up next and a way back while away from /setup", async () => {
    signIn("admin");
    api.get.mockResolvedValue(withRows);
    await useSetupStore().load();
    const wrapper = mountWidget();

    expect(wrapper.text()).toContain('setup.nav.progress {"ready":1,"total":2}');
    expect(wrapper.text()).toContain("setup.nav.upNext");
    expect(wrapper.get("a").attributes("href")).toBe("/setup");
    expect(wrapper.get('[role="progressbar"]').attributes("aria-valuenow")).toBe("50");
  });

  it("hides on /setup itself", async () => {
    signIn("admin");
    api.get.mockResolvedValue(withRows);
    await useSetupStore().load();
    expect(mountWidget("/setup").find("[data-testid=setup-widget]").exists()).toBe(false);
  });

  it("hides for roles without access, without calling the server", async () => {
    signIn("agent");
    const store = useSetupStore();
    await store.load();
    expect(api.get).not.toHaveBeenCalled();
    expect(store.showInNav).toBe(false);
    expect(mountWidget().find("[data-testid=setup-widget]").exists()).toBe(false);
  });

  it("hides once setup is finished or everything is ready", async () => {
    signIn("owner");
    const store = useSetupStore();
    api.get.mockResolvedValue(board({ rows, finishedAt: "2026-11-05T11:00:00.000Z" }));
    await store.load({ force: true });
    expect(store.showInNav).toBe(false);

    api.get.mockResolvedValue(
      board({ rows: [row({ id: "a", status: "ready" })], upNext: { kind: "done" } }),
    );
    await store.load({ force: true });
    expect(store.showInNav).toBe(false);
    expect(mountWidget().find("[data-testid=setup-widget]").exists()).toBe(false);
  });

  it("treats a FORBIDDEN answer as no access instead of an error", async () => {
    signIn("owner");
    const { TRPCClientError } = await import("@trpc/client");
    api.get.mockRejectedValue(
      TRPCClientError.from({
        error: { message: "no", code: -32003, data: { code: "FORBIDDEN" } },
      } as never),
    );
    const store = useSetupStore();
    await store.load();
    expect(store.status).toBe("forbidden");
    expect(store.showInNav).toBe(false);
  });

  it("shares one request between concurrent callers", async () => {
    signIn("owner");
    api.get.mockResolvedValue(withRows);
    const store = useSetupStore();
    await Promise.all([store.load(), store.load(), store.load()]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

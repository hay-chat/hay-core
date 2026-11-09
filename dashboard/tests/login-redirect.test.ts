// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { route, router, stubNuxtGlobals, uiStubs } from "./component-harness";

const authStore = { isAuthenticated: true };
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authStore }));
vi.mock("@/utils/api", () => ({ Hay: {}, HayAuthApi: {} }));

describe("login redirect", () => {
  beforeEach(() => {
    stubNuxtGlobals();
    Object.entries({ computed, onMounted, reactive, ref, watch }).forEach(([name, value]) =>
      vi.stubGlobal(name, value),
    );
    router.push.mockClear();
    route.path = "/login";
  });

  async function loadLogin(redirect: unknown) {
    route.query = { redirect };
    const { default: Login } = await import("../pages/login.vue");
    mount(Login, {
      global: {
        stubs: { ...uiStubs, NuxtLayout: { template: "<div><slot /></div>" } },
        mocks: { $t: (key: string) => key },
      },
    });
    await flushPromises();
  }

  it("goes to an internal path", async () => {
    await loadLogin("/conversations?x=1");
    expect(router.push).toHaveBeenCalledWith("/conversations?x=1");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "falls back to the dashboard for %s",
    async (redirect) => {
      await loadLogin(redirect);
      expect(router.push).toHaveBeenCalledWith("/");
    },
  );
});

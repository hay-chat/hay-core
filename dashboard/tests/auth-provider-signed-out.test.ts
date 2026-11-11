// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { router, stubNuxtGlobals } from "./component-harness";

const authStore = { isAuthenticated: false, isInitialized: true };
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authStore }));
vi.mock("@/utils/api", () => ({ Hay: {} }));
vi.mock("@/utils/session-refresh", () => ({ isDefinitiveAuthFailure: () => true }));
vi.mock("@/composables/useHeartbeat", () => ({
  useHeartbeat: () => ({ startHeartbeat: vi.fn(), stopHeartbeat: vi.fn() }),
}));

async function mountOn(meta: Record<string, unknown>) {
  vi.stubGlobal("useRoute", () => ({ meta, fullPath: "/settings/profile" }));
  const { default: AuthProvider } = await import("../components/auth/AuthProvider.vue");
  const wrapper = mount(AuthProvider, {
    slots: { default: '<main data-test="app">app</main>' },
    global: { stubs: { Loading: true }, mocks: { $t: (key: string) => key } },
  });
  await flushPromises();
  return wrapper;
}

describe("AuthProvider when signed out with auth already initialized", () => {
  beforeEach(() => {
    stubNuxtGlobals();
    Object.entries({ computed, nextTick, onMounted, onUnmounted, ref, watch }).forEach(
      ([name, value]) => vi.stubGlobal(name, value),
    );
    router.push.mockClear();
    authStore.isAuthenticated = false;
    authStore.isInitialized = true;
  });

  it("sends a protected page to login without rendering the app", async () => {
    const wrapper = await mountOn({});
    expect(router.push).toHaveBeenCalledWith({
      path: "/login",
      query: { redirect: "/settings/profile" },
    });
    expect(wrapper.find('[data-test="app"]').exists()).toBe(false);
  });

  it("leaves public pages alone", async () => {
    const wrapper = await mountOn({ public: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="app"]').exists()).toBe(true);
  });

  it("renders the app for a signed-in user", async () => {
    authStore.isAuthenticated = true;
    const wrapper = await mountOn({});
    expect(router.push).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="app"]').exists()).toBe(true);
  });
});

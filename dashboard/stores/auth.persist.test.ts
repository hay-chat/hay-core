import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createPersistedState } from "pinia-plugin-persistedstate";
import { createApp } from "vue";

const login = vi.fn();

vi.mock("@/utils/api", () => ({
  HayApi: {},
  HayAuthApi: { auth: { login: { mutate: login } } },
}));
vi.mock("./setup", () => ({ useSetupStore: () => ({ reset: vi.fn() }) }));
vi.mock("./user", () => ({ useUserStore: () => ({ setUser: vi.fn() }) }));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    dump: () => [...values.values()].join("\n"),
  };
}

describe("auth store persistence", () => {
  const storage = memoryStorage();

  beforeEach(() => {
    const pinia = createPinia();
    pinia.use(createPersistedState({ storage, auto: false }));
    createApp({}).use(pinia);
    setActivePinia(pinia);
    login.mockResolvedValue({
      user: { id: "u1" },
      accessToken: "secret-access-token",
      expiresIn: 900,
    });
  });

  it("keeps tokens out of storage and asks for the cookie", async () => {
    const { useAuthStore } = await import("./auth");
    const store = useAuthStore();

    await store.login("a@example.com", "pw");

    expect(store.tokens?.accessToken).toBe("secret-access-token");
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ useCookie: true }));
    expect(storage.dump()).toContain("isAuthenticated");
    expect(storage.dump()).not.toContain("secret-access-token");
  });
});

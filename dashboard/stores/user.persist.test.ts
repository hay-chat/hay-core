import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createPersistedState } from "pinia-plugin-persistedstate";
import { createApp, nextTick } from "vue";
import { useUserStore } from "./user";

describe("user store persistence", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };

  beforeEach(() => {
    values.clear();
    const pinia = createPinia();
    pinia.use(createPersistedState({ storage, auto: false }));
    createApp({}).use(pinia);
    setActivePinia(pinia);
  });

  it("stores the session's user without email addresses, and leaves them in memory", async () => {
    const store = useUserStore();
    store.user = { id: "u1", email: "person@example.com", pendingEmail: "new@example.com" };
    await nextTick();

    const stored = [...values.values()].join("\n");
    expect(stored).toContain('"id":"u1"');
    expect(stored).not.toContain("@example.com");
    expect(store.user.email).toBe("person@example.com");
  });
});

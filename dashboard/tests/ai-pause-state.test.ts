import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUserStore } from "../stores/user";

// "Pause AI everywhere" (D11-9): the banner reads the store, which the
// organization_access_changed event updates on every open dashboard.
describe("user store: the team's AI pause", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("follows the access state pushed by the server", () => {
    const store = useUserStore();
    store.organizations = [{ id: "org-1", name: "Shop", slug: "shop" }];
    store.activeOrganizationId = "org-1";
    expect(store.isAiPausedByTeam).toBe(false);

    store.applyAccessState("org-1", {
      aiPausedAt: "2026-10-28T09:00:00Z",
      aiPausedByUserId: "user-1",
    });
    expect(store.isAiPausedByTeam).toBe(true);

    store.applyAccessState("org-1", { aiPausedAt: null, aiPausedByUserId: null });
    expect(store.isAiPausedByTeam).toBe(false);
  });
});

import { test, expect } from "@playwright/test";

test.describe("Webchat ePrivacy consent strict", () => {
  test("should not use web storage before first user interaction", async ({ page }) => {
    // Ensure we're on the dashboard origin (baseURL) so we can inspect storage keys reliably.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Snapshot existing storage keys (dashboard auth state uses localStorage).
    const before = await page.evaluate(() => {
      return {
        local: Object.keys(window.localStorage),
        session: Object.keys(window.sessionStorage),
        orgId: (() => {
          try {
            const raw = window.localStorage.getItem("pinia:user");
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.user?.activeOrganizationId ?? null;
          } catch {
            return null;
          }
        })() as string | null,
      };
    });

    expect(before.orgId, "Expected activeOrganizationId from auth state").toBeTruthy();

    // Configure and load the widget in strict mode.
    await page.addScriptTag({
      content: `
        window.HayChat = window.HayChat || {};
        window.HayChat.config = {
          organizationId: ${JSON.stringify(before.orgId)},
          baseUrl: "http://localhost:3001",
          consent: "strict"
        };
      `,
    });

    await page.addStyleTag({
      url: "http://localhost:3001/v1/webchat/widget.css",
    });

    await page.addScriptTag({
      url: "http://localhost:3001/v1/webchat/widget.js",
    });

    // Wait for widget container to exist (no interaction yet).
    await page.waitForSelector("#hay-webchat-root", { state: "attached" });

    // Assert: no new hay-* keys were written before interaction.
    const afterLoad = await page.evaluate(() => {
      return {
        local: Object.keys(window.localStorage),
        session: Object.keys(window.sessionStorage),
      };
    });

    const newLocal = afterLoad.local.filter((k) => !before.local.includes(k));
    const newSession = afterLoad.session.filter((k) => !before.session.includes(k));

    const newHayLocal = newLocal.filter((k) => k.startsWith("hay-"));
    const newHaySession = newSession.filter((k) => k.startsWith("hay-"));

    expect(newHayLocal, `Unexpected new localStorage keys: ${newLocal.join(", ")}`).toEqual([]);
    expect(newHaySession, `Unexpected new sessionStorage keys: ${newSession.join(", ")}`).toEqual(
      [],
    );

    // Opening the launcher must NOT unlock storage under the first-message gate.
    // The ePrivacy "service explicitly requested" signal is the first message, not the click.
    await page.locator("button.hay-chat-button").click();
    await page.waitForSelector("#hay-webchat-root", { state: "visible" });

    const afterOpen = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    const newLocalAfterOpen = afterOpen.local
      .filter((k) => !before.local.includes(k))
      .filter((k) => k.startsWith("hay-"));
    const newSessionAfterOpen = afterOpen.session
      .filter((k) => !before.session.includes(k))
      .filter((k) => k.startsWith("hay-"));
    expect(
      newLocalAfterOpen,
      `Opening the launcher must not write localStorage: ${newLocalAfterOpen.join(", ")}`,
    ).toEqual([]);
    expect(
      newSessionAfterOpen,
      `Opening the launcher must not write sessionStorage: ${newSessionAfterOpen.join(", ")}`,
    ).toEqual([]);

    // First user interaction proper: type a message and send it.
    await page.locator("textarea, input[type='text']").first().fill("hello");
    await page.keyboard.press("Enter");

    // Now storage usage is allowed; expect at least session storage to be used
    // for conversation tracking once the first message lands.
    await page.waitForFunction(() => {
      return Object.keys(window.sessionStorage).some((k) => k.startsWith("hay-"));
    });
  });
});

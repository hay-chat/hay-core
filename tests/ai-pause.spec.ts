import { test, expect, type Page } from "@playwright/test";

/**
 * Pausing the AI is one step and lives on the organization ("Pause AI
 * everywhere" on the Inbox): one click pauses it, the state survives a reload,
 * the server stores it, and one click resumes it. Agents and their own
 * on/off switch are gone; this is the only pause the owner has.
 */

const API = "http://localhost:3001/v1";

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const ls = await page.evaluate(() => ({
    auth: localStorage.getItem("auth") ?? "{}",
    user: localStorage.getItem("user") ?? "{}",
  }));
  const auth = JSON.parse(ls.auth) as { tokens?: { accessToken?: string } };
  const user = JSON.parse(ls.user) as { activeOrganizationId?: string };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.tokens?.accessToken) headers["Authorization"] = `Bearer ${auth.tokens.accessToken}`;
  if (user.activeOrganizationId) headers["x-organization-id"] = user.activeOrganizationId;
  return headers;
}

async function serverPausedAt(page: Page): Promise<string | null> {
  const resp = await page.request.get(`${API}/organizations.getAiPause`, {
    headers: await authHeaders(page),
  });
  expect(resp.ok(), `organizations.getAiPause failed: ${resp.status()}`).toBe(true);
  const body = (await resp.json()) as { result: { data: { pausedAt: string | null } } };
  return body.result.data.pausedAt;
}

async function setServerPause(page: Page, paused: boolean): Promise<void> {
  await page.request.post(`${API}/organizations.setAiPause`, {
    headers: await authHeaders(page),
    data: { paused },
  });
}

test.describe("Pause AI everywhere", () => {
  test("one click pauses the AI, the state persists, one click resumes it", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");
    await setServerPause(page, false);

    try {
      await page.reload();
      await page.waitForLoadState("networkidle");

      const card = page.getByTestId("ai-pause-card");
      const toggle = card.getByRole("switch");
      await expect(card).toBeVisible({ timeout: 10000 });
      await expect(card).toContainText("AI is replying");

      // One step: pause.
      await toggle.click();
      await expect(card).toContainText("AI paused");
      await expect(page.getByText("AI paused everywhere")).toBeVisible();

      // Persisted: survives a reload and the server stores it.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(card).toContainText("AI paused", { timeout: 10000 });
      expect(await serverPausedAt(page)).not.toBeNull();

      // One step: resume.
      await card.getByRole("switch").click();
      await expect(card).toContainText("AI is replying");
      await expect(page.getByText("AI resumed")).toBeVisible();
      await expect.poll(() => serverPausedAt(page)).toBeNull();
    } finally {
      await setServerPause(page, false);
    }
  });
});

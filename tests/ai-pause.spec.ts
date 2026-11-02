import { test, expect, type Page } from "@playwright/test";

/**
 * Pausing the AI must be one step: on /agents a single click on "Pause"
 * flips the agent to Paused, the state survives a reload, the server stores
 * enabled = false, and "Resume" brings it back.
 */

const API = "http://localhost:3001/v1";

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const ls = await page.evaluate(() => ({
    auth: localStorage.getItem("pinia:auth") ?? "{}",
    user: localStorage.getItem("pinia:user") ?? "{}",
  }));
  const auth = JSON.parse(ls.auth) as { tokens?: { accessToken?: string } };
  const user = JSON.parse(ls.user) as { user?: { activeOrganizationId?: string } };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.tokens?.accessToken) headers["Authorization"] = `Bearer ${auth.tokens.accessToken}`;
  if (user.user?.activeOrganizationId) {
    headers["x-organization-id"] = user.user.activeOrganizationId;
  }
  return headers;
}

async function createAgent(page: Page, name: string): Promise<string> {
  const resp = await page.request.post(`${API}/agents.create`, {
    headers: await authHeaders(page),
    data: { name, description: "Created by agent-pause.spec", enabled: true },
  });
  expect(resp.ok(), `agents.create failed: ${resp.status()} ${await resp.text()}`).toBe(true);
  const body = (await resp.json()) as { result: { data: { id: string } } };
  return body.result.data.id;
}

async function getAgentEnabled(page: Page, id: string): Promise<boolean> {
  const input = encodeURIComponent(JSON.stringify({ id }));
  const resp = await page.request.get(`${API}/agents.get?input=${input}`, {
    headers: await authHeaders(page),
  });
  expect(resp.ok(), `agents.get failed: ${resp.status()}`).toBe(true);
  const body = (await resp.json()) as { result: { data: { enabled: boolean } } };
  return body.result.data.enabled;
}

async function deleteAgent(page: Page, id: string): Promise<void> {
  await page.request.post(`${API}/agents.delete`, {
    headers: await authHeaders(page),
    data: { id },
  });
}

test.describe("Agent pause switch", () => {
  test("one click pauses the agent, the state persists, one click resumes it", async ({ page }) => {
    await page.goto("/agents");
    await page.waitForLoadState("networkidle");
    const agentId = await createAgent(page, `Pause E2E ${Date.now()}`);

    try {
      await page.reload();
      await page.waitForLoadState("networkidle");

      const card = page.locator(`[data-testid="agent-card"][data-agent-id="${agentId}"]`);
      const status = card.locator('[data-testid="agent-status"]');
      const toggle = card.locator('[data-testid="agent-toggle"]');

      await expect(card).toBeVisible({ timeout: 10000 });
      await expect(status).toHaveText(/Active/);
      await expect(toggle).toHaveText(/Pause/);

      // One step: pause.
      await toggle.click();
      await expect(status).toHaveText(/Paused/);
      await expect(toggle).toHaveText(/Resume/);
      await expect(
        page.getByText("Agent paused. New customer messages wait in Needs Attention."),
      ).toBeVisible();

      // Persisted: survives a reload and the server stores enabled = false.
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(status).toHaveText(/Paused/, { timeout: 10000 });
      expect(await getAgentEnabled(page, agentId)).toBe(false);

      // One step: resume.
      await toggle.click();
      await expect(status).toHaveText(/Active/);
      await expect(page.getByText("Agent resumed. It replies to customers again.")).toBeVisible();
      await expect.poll(() => getAgentEnabled(page, agentId)).toBe(true);
    } finally {
      await deleteAgent(page, agentId);
    }
  });
});

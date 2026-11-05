import { test, expect, type Page } from "@playwright/test";

/**
 * The three-dot menus for playbooks: on a list card (it used to do nothing) and
 * in the editor header, where secondary actions sit behind one menu as on the
 * conversation page.
 */

const API = `${process.env.PLAYWRIGHT_SERVER_URL ?? "http://localhost:3001"}/v1`;

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

async function createPlaybook(page: Page, title: string, status: "active" | "draft") {
  await page.goto("/playbooks");
  const resp = await page.request.post(`${API}/playbooks.create`, {
    headers: await authHeaders(page),
    data: { title, trigger: "the customer asks about returns", status },
  });
  expect(resp.ok(), `playbooks.create failed: ${resp.status()}`).toBe(true);
  const body = (await resp.json()) as { result: { data: { id: string } } };
  return body.result.data.id;
}

const card = (page: Page, title: string) =>
  page.locator("div", { has: page.getByRole("heading", { name: title, exact: true }) }).filter({
    has: page.getByTestId("playbook-card-menu"),
  });

async function openCardMenu(page: Page, title: string) {
  await card(page, title).last().getByTestId("playbook-card-menu").click();
}

test("card menu opens in place and archives, then restores as a draft", async ({ page }) => {
  const title = `Menu ${Date.now()}`;
  await createPlaybook(page, title, "active");
  await page.reload();

  await openCardMenu(page, title);
  await expect(page).toHaveURL(/\/playbooks$/);
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
  await expect(card(page, title).last().getByText("Archived")).toBeVisible();

  await openCardMenu(page, title);
  await page.getByRole("menuitem", { name: "Restore as draft" }).click();
  await expect(card(page, title).last().getByText("Draft")).toBeVisible();
});

test("card menu duplicates into a draft and opens it", async ({ page }) => {
  const title = `Copy me ${Date.now()}`;
  await createPlaybook(page, title, "active");
  await page.reload();

  await openCardMenu(page, title);
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  await expect(page).toHaveURL(/\/playbooks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Title" }).first()).toHaveValue(`${title} (copy)`);
});

test("editor header keeps Save and Publish out, the rest in the menu", async ({ page }) => {
  const title = `Header ${Date.now()}`;
  const id = await createPlaybook(page, title, "draft");
  await page.goto(`/playbooks/${id}`);

  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Version History" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Playbook" })).toHaveCount(0);

  const menu = page.getByTestId("playbook-actions-menu");
  await menu.click();
  for (const name of [
    "Improve with AI",
    "Version History",
    "Test this draft",
    "Replay past conversations",
    "Delete Playbook",
  ]) {
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  }

  await page.getByRole("menuitem", { name: "Delete Playbook" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
  await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
});

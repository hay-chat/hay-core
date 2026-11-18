/**
 * Screenshots for hay-docs/user-guide. One test per image; the image path is the `name` passed to
 * shoot(). Data comes from server/scripts/seed-docs-screenshots.ts.
 *
 * Wait for real content (a heading or a seeded name), never for a fixed time: a screenshot of a
 * loading skeleton must fail the run instead of landing in the docs.
 */
import { expect, test, type Page } from "@playwright/test";
import { seedIds, shoot } from "./shoot";

async function open(page: Page, path: string, ready: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByText(ready).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

test("dashboard: overview", async ({ page }) => {
  await open(page, "/dashboard", "Recent Conversations");
  await expect(page.getByText("resolved by AI")).toBeVisible();
  await expect(page.getByText("Ceramic lamp arrived cracked").first()).toBeVisible();
  await shoot(page, { name: "user-guide/images/dashboard/overview" });
});

test("inbox: overview", async ({ page }) => {
  await open(page, "/inbox", "conversations are waiting for a human");
  await expect(page.getByText("Priya Shah")).toBeVisible();
  await shoot(page, { name: "user-guide/images/inbox/overview" });
});

test("inbox: question for the team", async ({ page }) => {
  await open(page, "/inbox", "Questions for the team");
  const card = page.getByRole("listitem").filter({ hasText: "Liam O'Connor" });
  await shoot(page, {
    name: "user-guide/images/inbox/question-for-the-team",
    clip: card,
    padding: 6,
    highlight: [
      { target: card.getByRole("textbox"), label: "1" },
      {
        target: [card.getByRole("switch"), card.getByText("Send as written", { exact: true })],
        label: "2",
      },
      {
        target: [card.getByRole("checkbox"), card.getByText("Save to knowledge", { exact: true })],
        label: "3",
      },
      { target: card.getByRole("button", { name: "Send answer" }), label: "4" },
    ],
  });
});

test("action approvals: request in the inbox", async ({ page }) => {
  await open(page, "/inbox", "Waiting for your approval");
  const card = page.getByRole("listitem").filter({ hasText: "Sofia Rossi" });
  await shoot(page, {
    name: "user-guide/images/action-approvals/inbox-request",
    clip: card,
    padding: 6,
    highlight: [
      {
        target: [
          card.getByRole("button", { name: "Approve", exact: true }),
          card.getByRole("button", { name: "Decline" }),
        ],
      },
    ],
  });
});

test("conversations: conversation detail", async ({ page }) => {
  await open(page, `/conversations/${seedIds().featuredConversationId}`, "Customer Information");
  await expect(page.getByText("Get Order")).toBeVisible();
  await shoot(page, {
    name: "user-guide/images/conversations/detail",
    highlight: [{ target: page.getByRole("button", { name: "Take Over" }).first() }],
  });
});

test("playbooks: list", async ({ page }) => {
  await open(page, "/playbooks", "Damaged item");
  await shoot(page, {
    name: "user-guide/images/playbooks/list",
    // Step 2 of "Creating a Playbook": click the + button.
    highlight: [{ target: page.getByRole("button", { name: "Create Playbook" }), label: "2" }],
  });
});

test("documents: list", async ({ page }) => {
  await open(page, "/documents", "Caring for solid oak furniture");
  await shoot(page, {
    name: "user-guide/images/documents/list",
    highlight: [{ target: page.getByRole("button", { name: "Import Document" }) }],
  });
});

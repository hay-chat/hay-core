import { test, expect } from "@playwright/test";
import { register } from "tsx/cjs/api";

// The seeding helper imports TypeORM entities (legacy decorators), which
// Playwright's TypeScript transform cannot compile — load it through tsx, like
// global-setup.js does. Stays registered for the worker's lifetime because
// TypeORM keeps loading files lazily after the first call.
register();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seed = require("./helpers/approval-seed.ts") as typeof import("./helpers/approval-seed");

/**
 * Approval mode ("Require Approval"): a reviewer releases a queued AI reply from
 * the conversation page. The reply must leave the review queue in the UI and be
 * persisted as `sent` with the reviewer's edits, which is what channel delivery
 * (WhatsApp here) and the webchat socket pick up.
 *
 * The WhatsApp conversation is seeded directly in the database because no
 * channel plugin runs in the e2e environment.
 */

const ORIGINAL_REPLY = "E2E draft: your order ships tomorrow.";
const EDITED_REPLY = "E2E approved: your order ships on Tuesday.";

let seeded: Awaited<ReturnType<typeof seed.seedQueuedReply>>;

test.describe("Message approval", () => {
  test.beforeAll(async () => {
    seeded = await seed.seedQueuedReply(ORIGINAL_REPLY);
  });

  test.afterAll(async () => {
    if (seeded) await seed.cleanupQueuedReply(seeded);
  });

  test("reviewer edits and approves a queued reply, which is persisted as sent", async ({
    page,
  }) => {
    // No networkidle wait: the page keeps a WebSocket and a poll open, and a
    // cold dev server can take a while to serve the first route.
    await page.goto(`/conversations/${seeded.conversationId}`);

    // The queued reply is shown to the reviewer with its approval controls.
    const queuedBadge = page.getByText("Queued for Approval");
    await expect(queuedBadge).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(ORIGINAL_REPLY)).toBeVisible();

    await page.getByRole("button", { name: "Approve & Send", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Review AI Message")).toBeVisible();

    const editor = dialog.locator("textarea");
    await expect(editor).toHaveValue(ORIGINAL_REPLY);
    await editor.fill(EDITED_REPLY);
    await dialog.getByRole("button", { name: "Approve & Send Edited" }).click();

    // Review state clears and the edited text is what the conversation shows.
    await expect(dialog).toBeHidden();
    await expect(queuedBadge).toBeHidden({ timeout: 15000 });
    await expect(page.getByText(EDITED_REPLY)).toBeVisible({ timeout: 15000 });

    // Persisted state: released, edited, attributed to the reviewer.
    const stored = await seed.readMessage(seeded.messageId);
    expect(stored.deliveryState).toBe("sent");
    expect(stored.status).toBe("edited");
    expect(stored.content).toBe(EDITED_REPLY);
    expect(stored.originalContent).toBe(ORIGINAL_REPLY);
    expect(stored.approvedBy).toBe(seeded.userId);
    expect(stored.approvedAt).not.toBeNull();

    // A reload shows the released reply with no approval controls left.
    await page.reload();
    await expect(page.getByText(EDITED_REPLY)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Queued for Approval")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve & Send", exact: true })).toHaveCount(0);
  });
});

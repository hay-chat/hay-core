import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

/**
 * Email inbox channel — setup happy path.
 *
 * Installs the "Email inbox" plugin from the marketplace, saves the store's
 * support address and checks that the setup page shows the per-workspace
 * forwarding address and that the saved address survives a reload.
 *
 * Host prerequisites (otherwise the setup page shows the "not available on
 * this installation" notice and the forwarding address is hidden):
 *   EMAIL_INBOUND_DOMAIN, SMTP_FROM_EMAIL, RESEND_API_KEY, RESEND_WEBHOOK_SECRET
 * set in the server environment (.env.test for the Playwright webServer).
 */

test.describe.configure({ mode: "serial" });

const SUPPORT_ADDRESS = `support+e2e-${Date.now()}@example.com`;

test.describe("Email inbox channel setup", () => {
  test("installs the plugin, saves the support address and shows the forwarding address", async ({
    page,
  }) => {
    test.setTimeout(120000);

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[Browser error]: ${msg.text()}`);
      }
    });

    // 1. Marketplace → Email inbox card
    await navigateWithAuth(page, "/integrations/marketplace");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('h1:has-text("Marketplace")')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15000 });

    // The card opens the plugin page; a plugin that is not connected yet shows Connect there.
    const card = page.locator('[data-testid="marketplace-card"]:has-text("Email inbox")').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await page.waitForURL(/\/integrations\/plugins\//, { timeout: 20000 });
    const connect = page.locator('[data-testid="plugin-connect"]');
    if (await connect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await connect.click();
    }
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15000 });

    // 2. Settings: support address → Save
    const settingsTab = page.locator('[role="tab"]:has-text("Settings")');
    if (await settingsTab.isVisible().catch(() => false)) {
      await settingsTab.click();
    }
    const supportInput = page
      .locator('label:has-text("Your support address")')
      .locator("xpath=following::input[1]")
      .first();
    await expect(supportInput).toBeVisible({ timeout: 10000 });
    await supportInput.fill(SUPPORT_ADDRESS);

    const save = page.locator('button:has-text("Save")').first();
    await expect(save).toBeEnabled({ timeout: 5000 });
    await save.click();
    await page.waitForLoadState("networkidle");

    // 3. Setup page shows the per-workspace forwarding address
    const forwardingAddress = page.locator('[data-testid="email-forwarding-address"]');
    await expect(forwardingAddress).toBeVisible({ timeout: 30000 });
    await expect(forwardingAddress).toHaveText(/^in-[0-9a-f]{10}@[a-z0-9.-]+\.[a-z]{2,}$/);
    const alias = (await forwardingAddress.textContent())?.trim();
    console.log(`Forwarding address: ${alias}`);

    // The Gmail confirmation card only appears once a support address is saved.
    await expect(page.locator('[data-testid="email-confirmation-card"]')).toBeVisible({
      timeout: 10000,
    });

    // 4. Persisted: reload keeps the support address and the same alias
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({ timeout: 15000 });
    if (await settingsTab.isVisible().catch(() => false)) {
      await settingsTab.click();
    }
    const reloadedInput = page
      .locator('label:has-text("Your support address")')
      .locator("xpath=following::input[1]")
      .first();
    await expect(reloadedInput).toHaveValue(SUPPORT_ADDRESS, { timeout: 10000 });
    await expect(page.locator('[data-testid="email-forwarding-address"]')).toHaveText(alias ?? "", {
      timeout: 30000,
    });
  });
});

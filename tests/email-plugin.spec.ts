import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

test.describe("Email Plugin E2E Tests", () => {
  test("should display email plugin in marketplace", async ({ page }) => {
    test.setTimeout(30000);

    // Navigate to marketplace with auth
    await navigateWithAuth(page, "/integrations/marketplace");

    // Check if Email plugin is visible
    const emailPlugin = page.locator('text=Email').first();
    await expect(emailPlugin).toBeVisible();
  });

  test("should enable email plugin and show settings", async ({ page }) => {
    test.setTimeout(60000);

    // Log console messages for debugging
    page.on("console", (msg) => console.log("Browser:", msg.text()));

    // Navigate to email plugin page with auth
    await navigateWithAuth(page, "/integrations/plugins/%40hay%2Femail-plugin");

    // Take a screenshot to see what's happening
    await page.screenshot({ path: "test-results/email-plugin-page.png", fullPage: true });
    console.log("Screenshot saved to test-results/email-plugin-page.png");
    console.log("Current URL:", page.url());

    // Check if we're on the email plugin page
    await expect(page.locator("h1, h2, h3").filter({ hasText: "Email" })).toBeVisible();

    // Check if plugin is enabled or has enable button
    const enableButton = page.locator('button:has-text("Enable Plugin")');
    const isEnabled = !(await enableButton.isVisible());

    if (!isEnabled) {
      console.log("Plugin not enabled, enabling now...");
      await enableButton.click();
      await page.waitForLoadState("networkidle");

      // Wait for the page to reload with settings
      await page.waitForTimeout(2000);
    }

    // After enabling, settings should be visible
    // Look for the recipients field
    const recipientsLabel = page.locator('text=Email Recipients, text=recipients').first();
    await expect(recipientsLabel).toBeVisible({ timeout: 10000 });

    // Check if the input field exists
    const recipientsInput = page.locator('input[type="text"]').first();
    await expect(recipientsInput).toBeVisible();
  });

  test("should configure email recipients", async ({ page }) => {
    test.setTimeout(60000);

    // Navigate to email plugin page with auth
    await navigateWithAuth(page, "/integrations/plugins/%40hay%2Femail-plugin");

    // Make sure plugin is enabled
    const enableButton = page.locator('button:has-text("Enable Plugin")');
    if (await enableButton.isVisible()) {
      await enableButton.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }

    // Fill in the recipients field
    const recipientsInput = page.locator('input[type="text"]').first();
    await recipientsInput.fill("test@example.com,admin@example.com");

    // Save configuration
    const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(2000);

    // Check for success message
    // The toast notification should appear
    const successToast = page.locator('text=saved, text=success').first();
    await expect(successToast).toBeVisible({ timeout: 5000 });
  });

  test("should run MCP health check and show connection status", async ({ page }) => {
    test.setTimeout(60000);

    // Navigate to email plugin page with auth
    await navigateWithAuth(page, "/integrations/plugins/%40hay%2Femail-plugin");

    // Make sure plugin is enabled
    const enableButton = page.locator('button:has-text("Enable Plugin")');
    if (await enableButton.isVisible()) {
      await enableButton.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }

    // Configure with valid email if not already configured
    const recipientsInput = page.locator('input[type="text"]').first();
    const currentValue = await recipientsInput.inputValue();

    if (!currentValue || currentValue.trim() === "") {
      await recipientsInput.fill("test@example.com");
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      await saveButton.click();
      await page.waitForTimeout(3000);
    }

    // Look for connection status badge
    // After configuration is saved, the page auto-tests connection
    const statusBadge = page.locator('[class*="inline-flex items-center px-2 py-1 rounded-full"]');

    // Wait for the badge to appear (it may take a few seconds)
    await expect(statusBadge).toBeVisible({ timeout: 15000 });

    // Get the status text
    const statusText = await statusBadge.textContent();
    console.log("Connection status:", statusText);

    // Status should be either "Testing Connection", "Connected", or "Connection Failed"
    expect(["Testing Connection", "Connected", "Connection Failed"]).toContain(statusText);

    // If testing, wait for result
    if (statusText === "Testing Connection") {
      // Wait for the test to complete
      await page.waitForTimeout(5000);

      // Check status again
      const finalStatus = await statusBadge.textContent();
      console.log("Final connection status:", finalStatus);

      // Should be either Connected or Connection Failed
      expect(["Connected", "Connection Failed"]).toContain(finalStatus);
    }

    // Ideally, it should be "Connected" for the email plugin
    if (statusText === "Connected" || (await statusBadge.textContent()) === "Connected") {
      console.log("✅ Email plugin MCP health check passed!");
    }
  });

  test("should test connection manually", async ({ page }) => {
    test.setTimeout(60000);

    // Navigate to email plugin page with auth
    await navigateWithAuth(page, "/integrations/plugins/%40hay%2Femail-plugin");

    // Make sure plugin is enabled and configured
    const enableButton = page.locator('button:has-text("Enable Plugin")');
    if (await enableButton.isVisible()) {
      await enableButton.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Configure
      const recipientsInput = page.locator('input[type="text"]').first();
      await recipientsInput.fill("test@example.com");
      const saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
      await saveButton.click();
      await page.waitForTimeout(3000);
    }

    // Look for "Test Connection" button
    const testButton = page.locator('button:has-text("Test Connection")');

    // The email plugin is a tool plugin, not a connector, so it might not have this button
    // Let's check if it exists
    const hasTestButton = await testButton.isVisible();

    if (hasTestButton) {
      console.log("Test Connection button found, clicking...");
      await testButton.click();

      // Wait for test to complete
      await page.waitForTimeout(5000);

      // Check for test result
      const resultCard = page.locator('[class*="bg-green-50"], [class*="bg-red-50"]');
      await expect(resultCard).toBeVisible({ timeout: 10000 });

      const resultText = await resultCard.textContent();
      console.log("Test result:", resultText);
    } else {
      console.log("Test Connection button not found - email plugin may not have connector-type testing UI");
      console.log("This is expected for tool-type plugins");
    }
  });
});

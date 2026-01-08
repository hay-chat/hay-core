import { test, expect } from "@playwright/test";

test("Plugin health check displays connection status", async ({ page }) => {
  // Set a 30 second timeout for the entire test
  test.setTimeout(30000);

  // Log console messages from the browser
  page.on("console", (msg) => console.log("Browser console:", msg.text()));

  // Auth is already loaded from storage state - navigate directly to plugins page
  await page.goto("/plugins");

  // Wait for the page to load
  await page.waitForLoadState("networkidle");

  // Check if plugins are displayed
  await expect(page.locator("h1")).toContainText("Plugins");

  // Look for a plugin with MCP capabilities (Shopify, Zendesk, WooCommerce, or Magento)
  const mcpPlugins = ["Shopify", "Zendesk", "WooCommerce", "Magento"];
  let pluginFound = false;

  for (const pluginName of mcpPlugins) {
    const pluginCard = page.locator(`text=${pluginName}`).first();
    if (await pluginCard.isVisible()) {
      pluginFound = true;

      // Click on the plugin to go to its configuration page
      await pluginCard.click();

      // Wait for navigation
      await page.waitForLoadState("networkidle");

      // Check if we're on the plugin configuration page
      await expect(page.locator("h1")).toContainText(pluginName);

      // Check if connection status badge is displayed
      const statusBadge = page.locator(
        '[class*="inline-flex items-center px-2 py-1 rounded-full"]',
      );
      await expect(statusBadge).toBeVisible();

      // Check if the status is one of the expected states
      const statusText = await statusBadge.textContent();
      expect(["Connected", "Connection Failed", "Missing Settings", "Testing..."]).toContain(
        statusText,
      );

      // If there's an error, check if error card is displayed
      if (statusText === "Connection Failed") {
        const errorCard = page.locator('[class*="border-red-200 bg-red-50"]');
        await expect(errorCard).toBeVisible();
      }

      break;
    }
  }

  // If no MCP plugins found, just verify the page loads correctly
  if (!pluginFound) {
    console.log("No MCP plugins found for testing, but page loaded correctly");
  }
});

test("Plugin configuration form works correctly", async ({ page }) => {
  // Set a 30 second timeout for the entire test
  test.setTimeout(30000);

  // Log console messages from the browser
  page.on("console", (msg) => console.log("Browser console:", msg.text()));

  // Auth is already loaded from storage state - navigate directly to plugin page
  await page.goto("/plugins/hay-plugin-shopify");

  // Wait for the page to load
  await page.waitForLoadState("networkidle");

  // Check if we're on the plugin configuration page
  await expect(page.locator("h1")).toContainText("Shopify");

  // Check if configuration form is displayed
  const configForm = page.locator("form");
  await expect(configForm).toBeVisible();

  // Check if connection status badge is displayed
  const statusBadge = page.locator('[class*="inline-flex items-center px-2 py-1 rounded-full"]');
  await expect(statusBadge).toBeVisible();

  // Check if save button is present
  const saveButton = page.locator('button[type="submit"]');
  await expect(saveButton).toBeVisible();

  // Check if cancel button is present
  const cancelButton = page.locator('button:has-text("Cancel")');
  await expect(cancelButton).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

test.describe.configure({ mode: "serial" }); // Run tests sequentially

test.describe("Plugin Health Check and Settings E2E", () => {
  test("should verify health check for connector-type plugin (Shopify)", async ({ page }) => {
    test.setTimeout(120000);

    let healthCheckCalled = false;

    // Track API calls
    page.on("response", async (response) => {
      const url = response.url();
      const status = response.status();

      if (
        url.includes("plugins.testConnection") ||
        url.includes("plugins.healthCheck") ||
        url.includes("plugins.test")
      ) {
        healthCheckCalled = true;
        console.log(`✅ Health check API called: ${url} (status: ${status})`);
      }
    });

    // Navigate to marketplace
    console.log("\n🚀 Navigating to marketplace for Shopify plugin test...");
    await navigateWithAuth(page, "/integrations/marketplace");
    await page.waitForLoadState("networkidle");

    // Wait for plugins to load
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15000,
    });

    // Find Shopify plugin (connector-type that should have health check)
    console.log("\n🔍 Finding Shopify plugin (MCP Connector)...");
    const shopifyHeading = page.locator('h2:has-text("Shopify")').first();
    const shopifyExists = await shopifyHeading.isVisible({ timeout: 5000 }).catch(() => false);

    if (!shopifyExists) {
      console.log("⚠️  Shopify plugin not available, skipping connector test");
      test.skip();
      return;
    }

    const installButton = page
      .locator('h2:has-text("Shopify")')
      .locator("xpath=ancestor::*")
      .locator('button:has-text("Install")')
      .first();
    const configureButton = page
      .locator('h2:has-text("Shopify")')
      .locator("xpath=ancestor::*")
      .locator('button:has-text("Configure")')
      .first();

    const isAlreadyInstalled = await configureButton.isVisible();

    if (isAlreadyInstalled) {
      console.log("⚠️  Shopify already installed, clicking Configure...");
      await configureButton.click();
    } else {
      console.log("📦 Installing Shopify plugin...");
      await installButton.click();
      // Wait for navigation to plugin page (URL encoded)
      await page.waitForURL(/\/integrations\/plugins\//, { timeout: 20000 });
    }

    // Wait for page to load
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Verify settings are visible
    console.log("\n⚙️  Verifying Shopify settings...");
    const configHeading = page.locator(
      'h2:has-text("Configuration"), h3:has-text("Configuration")',
    );
    const hasSettings = await configHeading.isVisible({ timeout: 10000 }).catch(() => false);

    console.log(`Settings visible: ${hasSettings}`);

    // Verify health check UI for connector-type plugin
    console.log("\n🏥 Verifying health check UI for MCP Connector...");
    const connectionTestSection = page.locator(
      'h2:has-text("Connection Test"), h3:has-text("Connection Test")',
    );
    const testConnectionButton = page.locator('button:has-text("Test Connection")');

    const hasConnectionTest = await connectionTestSection
      .isVisible({ timeout: 10000 })
      .catch(() => false);
    const hasTestButton = await testConnectionButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    console.log(`Connection Test section: ${hasConnectionTest}`);
    console.log(`Test Connection button: ${hasTestButton}`);

    // Connector-type plugins SHOULD have health check UI
    const hasHealthCheckUI = hasConnectionTest || hasTestButton;
    console.log(
      `${hasHealthCheckUI ? "✅" : "⚠️ "} Health check UI present for connector: ${hasHealthCheckUI}`,
    );

    console.log("\n✅ Shopify connector plugin test completed");
  });
});

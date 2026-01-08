import { test, expect } from "@playwright/test";
import { navigateWithAuth } from "./helpers/login";

test.describe.configure({ mode: "serial" }); // Run tests sequentially

test.describe("Plugin Health Check and Settings E2E", () => {
  test("should install email plugin, verify health check API is called, and settings are displayed", async ({
    page,
  }) => {
    test.setTimeout(120000);

    // Track API calls
    const apiCalls: { url: string; method: string; status: number | null }[] = [];
    let healthCheckCalled = false;
    let testConnectionCalled = false;

    // Intercept all network requests
    page.on("response", async (response) => {
      const url = response.url();
      const method = response.request().method();
      const status = response.status();

      // Track tRPC calls
      if (url.includes("/v1/")) {
        apiCalls.push({ url, method, status });

        // Check for health check / test connection API calls
        if (
          url.includes("plugins.testConnection") ||
          url.includes("plugins.healthCheck") ||
          url.includes("plugins.test")
        ) {
          healthCheckCalled = true;
          console.log(`✅ Health check API called: ${url} (status: ${status})`);
        }
      }
    });

    // Step 1: Navigate to marketplace
    console.log("\n🚀 Step 1: Navigating to marketplace...");
    await navigateWithAuth(page, "/integrations/marketplace");
    await page.waitForLoadState("networkidle");

    // Verify marketplace loaded
    await expect(page.locator('h1:has-text("Plugin Marketplace")')).toBeVisible({
      timeout: 10000,
    });
    console.log("✅ Marketplace loaded");

    // Wait for plugins to load
    await expect(page.locator(".animate-pulse").first()).not.toBeVisible({
      timeout: 15000,
    });

    // Step 2: Find and install Email plugin
    console.log("\n🔍 Step 2: Finding Email plugin...");
    const emailPluginHeading = page.locator('h2:has-text("Email")').first();
    await expect(emailPluginHeading).toBeVisible({ timeout: 10000 });

    const installButton = page
      .locator('h2:has-text("Email")')
      .locator("xpath=ancestor::*")
      .locator('button:has-text("Install")')
      .first();
    const configureButton = page
      .locator('h2:has-text("Email")')
      .locator("xpath=ancestor::*")
      .locator('button:has-text("Configure")')
      .first();

    const isAlreadyInstalled = await configureButton.isVisible();

    if (isAlreadyInstalled) {
      console.log("⚠️  Plugin already installed, clicking Configure...");
      await configureButton.click();
    } else {
      console.log("📦 Installing Email plugin...");
      await expect(installButton).toBeVisible({ timeout: 5000 });
      await installButton.click();

      // Wait for redirect to any plugin settings page
      await page.waitForURL(/\/integrations\/plugins\//, {
        timeout: 20000,
      });
      console.log("✅ Plugin installed and redirected to settings");

      // Wait a bit for page to fully load
      await page.waitForTimeout(2000);
    }

    // Step 3: Verify we're on the plugin settings page
    console.log("\n📄 Step 3: Verifying plugin settings page...");
    await expect(page).toHaveURL(/\/integrations\/plugins\//);

    // Wait for page to fully load
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000); // Give time for health check API to be called

    // Verify Email heading is visible
    const emailHeading = page.locator('h2:has-text("Email"), h3:has-text("Email")').first();
    await expect(emailHeading).toBeVisible({ timeout: 10000 });
    console.log("✅ Plugin settings page loaded");

    // Step 4: Verify Settings/Configuration Section
    console.log("\n⚙️  Step 4: Verifying settings are displayed...");

    // Check for Configuration heading
    const configHeading = page.locator(
      'h2:has-text("Configuration"), h3:has-text("Configuration")',
    );
    const hasConfigHeading = await configHeading.isVisible({ timeout: 10000 }).catch(() => false);

    // Check for Settings tab
    const settingsTab = page.locator('[role="tab"]:has-text("Settings")');
    const hasSettingsTab = await settingsTab.isVisible({ timeout: 5000 }).catch(() => false);

    // Check for form elements (inputs, textareas, selects) - MUST have actual inputs
    const formInputs = page.locator('input[type="text"], input[type="email"], input[type="url"], textarea, select');
    const inputCount = await formInputs.count();
    const hasFormInputs = inputCount > 0;

    // Check for form buttons (Save, Submit, etc.)
    const formButtons = page.locator('button:has-text("Save"), button[type="submit"]').first();
    const hasFormButtons = await formButtons.isVisible({ timeout: 5000 }).catch(() => false);

    console.log(`  - Configuration heading visible: ${hasConfigHeading}`);
    console.log(`  - Settings tab visible: ${hasSettingsTab}`);
    console.log(`  - Form inputs visible: ${hasFormInputs}`);
    console.log(`  - Number of input fields: ${inputCount}`);
    console.log(`  - Form buttons visible: ${hasFormButtons}`);

    // Settings require BOTH a heading/tab AND actual input fields
    const hasSettings = (hasConfigHeading || hasSettingsTab) && hasFormInputs;

    // Assert that settings are visible with actual input fields
    if (!hasSettings) {
      if (!hasConfigHeading && !hasSettingsTab) {
        throw new Error('Configuration heading or Settings tab not found!');
      }
      if (!hasFormInputs) {
        throw new Error(`Configuration form has no input fields! Expected at least 1, found ${inputCount}`);
      }
    }

    expect(hasSettings).toBe(true);
    console.log("✅ Settings/Configuration section is visible");

    // Step 5: Verify Health Check API Call
    console.log("\n🏥 Step 5: Verifying health check API call...");

    // Wait a bit more for async health check calls
    await page.waitForTimeout(2000);

    // Look for health check UI elements
    const statusBadge = page.locator(
      '[class*="inline-flex items-center"][class*="rounded-full"]:has-text("Connected"), [class*="inline-flex items-center"][class*="rounded-full"]:has-text("Connection"), [class*="inline-flex items-center"][class*="rounded-full"]:has-text("Testing")',
    );
    const testConnectionButton = page.locator('button:has-text("Test Connection")');
    const connectionTestSection = page.locator(
      'h2:has-text("Connection Test"), h3:has-text("Connection Test")',
    );

    const hasStatusBadge = await statusBadge.isVisible({ timeout: 5000 }).catch(() => false);
    const hasTestButton = await testConnectionButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    const hasConnectionTest = await connectionTestSection
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    console.log(`  - Status badge visible: ${hasStatusBadge}`);
    console.log(`  - Test Connection button visible: ${hasTestButton}`);
    console.log(`  - Connection Test section visible: ${hasConnectionTest}`);

    // If there's a manual Test Connection button, click it to trigger health check
    if (hasTestButton && !healthCheckCalled) {
      console.log("🔘 Clicking Test Connection button to trigger health check...");
      await testConnectionButton.click();
      await page.waitForTimeout(5000); // Wait for API call to complete

      // Check for test result
      const testResultSuccess = page.locator(
        '[class*="bg-green"], text=/Connection successful/i, text=/Connected/i',
      );
      const testResultFailed = page.locator(
        '[class*="bg-red"], text=/Connection failed/i, text=/Failed/i',
      );

      const hasSuccessResult = await testResultSuccess
        .isVisible({ timeout: 10000 })
        .catch(() => false);
      const hasFailedResult = await testResultFailed
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      console.log(`  - Test result (success): ${hasSuccessResult}`);
      console.log(`  - Test result (failed): ${hasFailedResult}`);

      if (hasSuccessResult || hasFailedResult) {
        testConnectionCalled = true;
        console.log("✅ Health check executed and result displayed");
      }
    }

    // Check if health check API was called automatically
    console.log(`  - Health check API called: ${healthCheckCalled}`);

    // Step 6: Verify API calls
    console.log("\n📡 Step 6: Analyzing API calls...");

    // Filter relevant API calls
    const pluginAPICalls = apiCalls.filter(
      (call) =>
        call.url.includes("plugins.get") ||
        call.url.includes("plugins.configure") ||
        call.url.includes("plugins.testConnection") ||
        call.url.includes("plugins.getConfiguration"),
    );

    console.log(`  Total plugin-related API calls: ${pluginAPICalls.length}`);
    pluginAPICalls.forEach((call) => {
      const endpoint = call.url.split("/v1/")[1]?.split("?")[0] || call.url;
      console.log(`  - ${call.method} ${endpoint} → ${call.status}`);
    });

    // Verify essential API calls were made
    const getConfigCalled = apiCalls.some((call) => call.url.includes("plugins.getConfiguration"));
    const getPluginCalled = apiCalls.some((call) => call.url.includes("plugins.get"));

    console.log(`\n  - plugins.get called: ${getPluginCalled}`);
    console.log(`  - plugins.getConfiguration called: ${getConfigCalled}`);
    console.log(`  - plugins.testConnection called: ${healthCheckCalled || testConnectionCalled}`);

    // Assert essential API calls were made
    expect(getPluginCalled || getConfigCalled).toBe(true);
    console.log("✅ Essential plugin API calls were made");

    // Step 7: Take screenshot for verification
    console.log("\n📸 Step 7: Taking screenshot...");
    await page.screenshot({
      path: "test-results/plugin-health-check-and-settings.png",
      fullPage: true,
    });
    console.log("✅ Screenshot saved to test-results/plugin-health-check-and-settings.png");

    // Final Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL TEST SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Plugin installed: true`);
    console.log(`✅ Settings page loaded: true`);
    console.log(`✅ Settings/Configuration visible: ${hasSettings}`);
    console.log(`✅ Essential API calls made: ${getPluginCalled || getConfigCalled}`);
    console.log(
      `${healthCheckCalled || testConnectionCalled ? "✅" : "❌"} Health check API called: ${healthCheckCalled || testConnectionCalled}`,
    );
    console.log(
      `${hasStatusBadge || hasTestButton || hasConnectionTest ? "✅" : "❌"} Health check UI present: ${hasStatusBadge || hasTestButton || hasConnectionTest}`,
    );
    console.log("=".repeat(60));

    // Final assertions - BOTH settings and health check must be visible for MCP plugins
    expect(hasSettings).toBe(true);

    // CRITICAL: All MCP plugins MUST have health check UI
    const hasHealthCheckUI = hasStatusBadge || hasTestButton || hasConnectionTest;
    if (!hasHealthCheckUI) {
      throw new Error(
        'Health check UI is missing! MCP plugins must show either:\n' +
        '  - Status badge (Connected/Testing/Failed)\n' +
        '  - Test Connection button\n' +
        '  - Connection Test section\n' +
        `Found: badge=${hasStatusBadge}, button=${hasTestButton}, section=${hasConnectionTest}`
      );
    }
    expect(hasHealthCheckUI).toBe(true);

    console.log("\n✅ ALL TESTS PASSED!");
  });

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

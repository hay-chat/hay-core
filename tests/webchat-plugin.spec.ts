import { test, expect } from "@playwright/test";

test.describe("Webchat Plugin Page", () => {
  test("should display webchat plugin page correctly with buttons and embed script", async ({
    page,
  }) => {
    // Capture console messages
    page.on("console", (msg) => {
      console.log(`BROWSER ${msg.type()}: ${msg.text()}`);
    });

    // Capture page errors
    page.on("pageerror", (error) => {
      console.log(`PAGE ERROR: ${error.message}`);
    });

    // Navigate to login page
    await page.goto("http://localhost:3000/login");

    // Fill in login credentials
    await page.fill('input[type="email"]', "");
    await page.fill('input[type="password"]', "");

    // Click login button
    await page.click('button[type="submit"]');

    // Wait for navigation after login
    await page.waitForURL(/http:\/\/localhost:3000\/(?!login)/, { timeout: 10000 });

    // Navigate to webchat plugin page
    await page.goto("http://localhost:3000/integrations/plugins/hay-plugin-webchat");

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Take initial screenshot
    await page.screenshot({ path: "test-results/webchat-plugin-initial.png", fullPage: true });

    // Check for buttons - they should be visible and interactive
    const buttons = page.locator("button");
    const buttonCount = await buttons.count();
    console.log(`Found ${buttonCount} buttons on the page`);

    // Take screenshot of buttons area
    if (buttonCount > 0) {
      await page.screenshot({ path: "test-results/webchat-plugin-buttons.png", fullPage: true });
    }

    // Check for embed script - it should be visible
    const embedScript = page.locator('code, pre, [class*="embed"], [class*="script"]');
    const embedCount = await embedScript.count();
    console.log(`Found ${embedCount} potential embed script elements`);

    // Look for script content containing the API URL
    const scriptContent = page.locator("text=/https?:\\/\\//");
    const scriptContentCount = await scriptContent.count();
    console.log(`Found ${scriptContentCount} elements with URL patterns`);

    // More specific check: look for textarea that should contain the embed code
    const textarea = page.locator("textarea[readonly]");
    const textareaCount = await textarea.count();
    console.log(`Found ${textareaCount} readonly textareas`);

    if (textareaCount > 0) {
      const textareaValue = await textarea.first().inputValue();
      console.log(`Textarea value length: ${textareaValue.length}`);
      console.log(`Textarea value preview: ${textareaValue.substring(0, 100)}`);
    }

    // Take final screenshot
    await page.screenshot({ path: "test-results/webchat-plugin-final.png", fullPage: true });

    // Assertions
    expect(buttonCount).toBeGreaterThan(0);

    // Check that embed script or URL is displayed
    const hasEmbedContent = textareaCount > 0 && (await textarea.first().inputValue()).length > 0;
    expect(hasEmbedContent).toBeTruthy();
  });
});

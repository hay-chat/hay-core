import { test, expect } from "@playwright/test";

test.describe("Simple Dashboard Screenshot", () => {
  test("capture dashboard with mock data", async ({ page }) => {
    // Navigate to dashboard
    await page.goto("http://localhost:3000");

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Wait longer for chart to process mock data
    await page.waitForTimeout(5000);

    // Take full page screenshot
    await page.screenshot({
      path: "test-results/dashboard-with-mock-data.png",
      fullPage: true,
    });

    // Check if dashboard loaded
    await expect(page.locator("h1")).toContainText("Dashboard");

    // Look for any chart elements
    const chartSection = page.locator("text=Conversation Activity");
    await expect(chartSection).toBeVisible();

    // Check if chart container exists (even if SVG isn't rendered yet)
    const hasChartContainer = await page.locator(".chart-container").count();
    console.log("Chart containers found:", hasChartContainer);

    // Check for any SVG elements
    const svgCount = await page.locator("svg").count();
    console.log("SVG elements found:", svgCount);

    // Log any console errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.waitForTimeout(2000);
    console.log("Console errors:", errors);
  });
});

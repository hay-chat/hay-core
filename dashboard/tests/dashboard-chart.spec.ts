import { test, expect } from "@playwright/test";

test.describe("Dashboard Chart", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard
    await page.goto("http://localhost:3000");

    // Wait for the page to load
    await page.waitForLoadState("networkidle");
  });

  test("should render the dashboard with chart", async ({ page }) => {
    // Take initial screenshot
    await page.screenshot({
      path: "test-results/dashboard-initial.png",
      fullPage: true,
    });

    // Check if the dashboard title is present
    await expect(page.locator("h1")).toContainText("Dashboard");

    // Check if the chart container is present
    const chartContainer = page.locator(".chart-container");
    await expect(chartContainer).toBeVisible();

    // Wait a bit for the chart to render
    await page.waitForTimeout(2000);

    // Take screenshot after chart should be rendered
    await page.screenshot({
      path: "test-results/dashboard-with-chart.png",
      fullPage: true,
    });
  });

  test("should display chart with conversation data", async ({ page }) => {
    // Wait for the chart to load
    await page.waitForSelector(".chart-container", { timeout: 10000 });

    // Check if VisXYContainer (unovis chart) is rendered
    const visContainer = page.locator(".chart-container svg");
    await expect(visContainer).toBeVisible();

    // Take screenshot of the chart area only
    await page.locator(".chart-container").screenshot({
      path: "test-results/chart-area.png",
    });

    // Check for chart elements (lines, axes)
    const chartElements = page.locator(".chart-container svg *");
    await expect(chartElements.first()).toBeVisible();

    console.log("Chart elements count:", await chartElements.count());
  });

  test("should show tooltip on hover", async ({ page }) => {
    // Wait for the chart to load
    await page.waitForSelector(".chart-container svg", { timeout: 10000 });

    // Take screenshot before hover
    await page.screenshot({
      path: "test-results/before-hover.png",
      fullPage: true,
    });

    // Get the chart SVG
    const chartSvg = page.locator(".chart-container svg");

    // Get the bounding box of the chart
    const chartBox = await chartSvg.boundingBox();

    if (chartBox) {
      // Calculate center point of chart
      const centerX = chartBox.x + chartBox.width / 2;
      const centerY = chartBox.y + chartBox.height / 2;

      console.log(`Hovering at chart center: ${centerX}, ${centerY}`);

      // Hover over the center of the chart
      await page.mouse.move(centerX, centerY);
      await page.waitForTimeout(500);

      // Take screenshot after hover
      await page.screenshot({
        path: "test-results/after-hover-center.png",
        fullPage: true,
      });

      // Try hovering over different points in the chart
      const points = [
        { x: chartBox.x + chartBox.width * 0.25, y: centerY },
        { x: chartBox.x + chartBox.width * 0.5, y: centerY },
        { x: chartBox.x + chartBox.width * 0.75, y: centerY },
      ];

      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        console.log(`Hovering at point ${i + 1}: ${point.x}, ${point.y}`);
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(1000);

        // Take screenshot at each point
        await page.screenshot({
          path: `test-results/hover-point-${i + 1}.png`,
          fullPage: true,
        });

        // Check for tooltip
        const tooltip = page.locator('[role="tooltip"], .tooltip, .vis-tooltip');
        const isTooltipVisible = await tooltip.isVisible().catch(() => false);
        console.log(`Tooltip visible at point ${i + 1}: ${isTooltipVisible}`);

        if (isTooltipVisible) {
          const tooltipText = await tooltip.textContent().catch(() => "Could not get tooltip text");
          console.log(`Tooltip text at point ${i + 1}: ${tooltipText}`);
        }
      }
    }
  });

  test("should log chart errors in console", async ({ page }) => {
    const errors: string[] = [];

    // Listen for console errors
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
        console.log("Console error:", msg.text());
      }
    });

    // Wait for the chart to load
    await page.waitForSelector(".chart-container", { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Take final screenshot
    await page.screenshot({
      path: "test-results/final-state.png",
      fullPage: true,
    });

    console.log("Total console errors:", errors.length);
    console.log("Errors:", errors);

    // We expect no chart-related errors
    const chartErrors = errors.filter(
      (error) =>
        error.includes("chart") ||
        error.includes("unovis") ||
        error.includes("NaN") ||
        error.includes("MNaN"),
    );

    console.log("Chart-related errors:", chartErrors);
    expect(chartErrors.length).toBe(0);
  });
});

import { test, expect } from "@playwright/test";

test.describe("Chart Component Standalone Test", () => {
  test("should test chart with mock data", async ({ page }) => {
    // Create a simple HTML page with our chart component to test it independently
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chart Test</title>
    <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
    <script src="https://unpkg.com/@unovis/ts@1.4.0/dist/index.js"></script>
    <script src="https://unpkg.com/@unovis/vue@1.4.0/dist/index.js"></script>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .chart-container { width: 100%; height: 400px; border: 1px solid #ccc; margin: 20px 0; }
    </style>
</head>
<body>
    <div id="app">
        <h1>Chart Tooltip Test</h1>
        <div class="chart-container">
            <vis-x-y-container 
                :data="data"
                :height="300"
                :width="600"
            >
                <vis-line
                    :x="xAccessor"
                    :y="yAccessors"
                    :line-width="2"
                    curve-type="basis"
                />
                <vis-scatter
                    :x="xAccessor"
                    :y="yAccessors"
                    :size="8"
                    :stroke-width="0"
                    :opacity="0.3"
                />
                <vis-axis type="x" />
                <vis-axis type="y" />
                <vis-tooltip :triggers="tooltipTriggers" />
            </vis-x-y-container>
        </div>
        <div>Data points: {{ data.length }}</div>
    </div>

    <script>
        console.log('Vue:', typeof Vue);
        console.log('Unovis:', typeof Unovis);
        
        const { createApp, ref, computed } = Vue;
        
        // Check if Unovis is loaded correctly
        if (!window.Unovis || !window.Unovis.Vue) {
            console.error('Unovis Vue components not loaded');
            document.body.innerHTML = '<h1>Error: Unovis not loaded</h1>';
        } else {
            console.log('Unovis Vue components available:', Object.keys(window.Unovis.Vue));
        }
        
        const { VisXYContainer, VisLine, VisScatter, VisAxis, VisTooltip } = window.Unovis.Vue;

        createApp({
            components: {
                VisXYContainer,
                VisLine,
                VisScatter,
                VisAxis,
                VisTooltip
            },
            setup() {
                const data = ref([
                    { date: "2025-09-01", count: 10, label: "Sep 1", chartIndex: 0 },
                    { date: "2025-09-02", count: 15, label: "Sep 2", chartIndex: 1 },
                    { date: "2025-09-03", count: 8, label: "Sep 3", chartIndex: 2 },
                    { date: "2025-09-04", count: 22, label: "Sep 4", chartIndex: 3 },
                    { date: "2025-09-05", count: 18, label: "Sep 5", chartIndex: 4 },
                    { date: "2025-09-06", count: 25, label: "Sep 6", chartIndex: 5 },
                    { date: "2025-09-07", count: 5, label: "Sep 7", chartIndex: 6 },
                    { date: "2025-09-08", count: 35, label: "Sep 8", chartIndex: 7 },
                    { date: "2025-09-09", count: 1, label: "Sep 9", chartIndex: 8 }
                ]);

                const xAccessor = computed(() => (d) => d.chartIndex);
                const yAccessors = computed(() => [(d) => d.count]);

                const tooltipTriggers = {
                    [VisScatter]: (d) => {
                        return \`<div style="padding: 8px; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <div style="font-weight: 500; margin-bottom: 4px;">\${d.label}</div>
                            <div style="font-size: 14px; color: #666;">
                                Conversations: <strong>\${d.count}</strong>
                            </div>
                        </div>\`;
                    }
                };

                return {
                    data,
                    xAccessor,
                    yAccessors,
                    tooltipTriggers
                };
            }
        }).mount('#app');
    </script>
</body>
</html>`;

    // Set the HTML content
    await page.setContent(htmlContent);

    // Wait for Vue and chart to initialize
    await page.waitForTimeout(2000);

    // Take initial screenshot
    await page.screenshot({
      path: "test-results/chart-standalone-initial.png",
      fullPage: true,
    });

    // Check if chart is rendered
    const chartContainer = page.locator(".chart-container");
    await expect(chartContainer).toBeVisible();

    // Check for SVG elements
    const svg = page.locator(".chart-container svg");
    await expect(svg).toBeVisible();

    // Take screenshot after chart should be rendered
    await page.screenshot({
      path: "test-results/chart-standalone-rendered.png",
      fullPage: true,
    });

    // Test hover functionality
    const chartBox = await svg.boundingBox();

    if (chartBox) {
      // Test hovering over different points
      const points = [
        { x: chartBox.x + chartBox.width * 0.2, y: chartBox.y + chartBox.height * 0.5 },
        { x: chartBox.x + chartBox.width * 0.5, y: chartBox.y + chartBox.height * 0.5 },
        { x: chartBox.x + chartBox.width * 0.8, y: chartBox.y + chartBox.height * 0.5 },
      ];

      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        console.log(`Hovering at point ${i + 1}: ${point.x}, ${point.y}`);

        // Move mouse to point
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(1000);

        // Take screenshot at each hover point
        await page.screenshot({
          path: `test-results/chart-standalone-hover-${i + 1}.png`,
          fullPage: true,
        });

        // Check for tooltip
        const tooltip = page.locator(
          '[role="tooltip"], .tooltip, .vis-tooltip, div[style*="position: absolute"]',
        );
        const isTooltipVisible = await tooltip.isVisible().catch(() => false);
        console.log(`Tooltip visible at point ${i + 1}: ${isTooltipVisible}`);

        if (isTooltipVisible) {
          const tooltipText = await tooltip.textContent().catch(() => "Could not get tooltip text");
          console.log(`Tooltip text at point ${i + 1}: ${tooltipText}`);
        }
      }
    }

    // Check for any errors
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
        console.log("Console error:", msg.text());
      }
    });

    await page.waitForTimeout(1000);
    console.log("Total console errors:", errors.length);
    console.log("Errors:", errors);
  });
});

import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

/**
 * Takes the screenshots used in hay-docs. Run with `npm run docs:screenshots`.
 * See tests/docs-screenshots/README.md.
 */
dotenv.config({ path: path.resolve(__dirname, ".env.test") });

const DASHBOARD_URL = process.env.PLAYWRIGHT_DASHBOARD_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/docs-screenshots",
  testMatch: "*.shots.ts",
  globalSetup: "./tests/docs-screenshots/global-setup.js",
  // One browser, one org: shots run in order and never race each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: DASHBOARD_URL,
    storageState: "playwright/.auth/docs.json",
    browserName: "chromium",
    // Fixed window, light theme, English and one time zone so images only change when the UI does.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "Europe/Dublin",
    reducedMotion: "reduce",
    trace: "off",
    // Optional: a Chromium that is already installed, instead of `npx playwright install`.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
});

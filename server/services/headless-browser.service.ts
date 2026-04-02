import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  install,
  Browser as PuppeteerBrowser,
  resolveBuildId,
  detectBrowserPlatform,
} from "@puppeteer/browsers";
import { createLogger } from "@server/lib/logger";
import { validateUrlForSSRF } from "@server/utils/ssrf";
import { config } from "@server/config/env";
import fs from "fs";
import path from "path";

const logger = createLogger("headless-browser");

const SYSTEM_CHROME_PATHS = [
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  // Windows (common paths)
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const BROWSER_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--no-first-run",
];

export class HeadlessBrowserService {
  private browser: Browser | null = null;
  private resolvedExecutablePath: string | null = null;
  private activePages = 0;
  private waitQueue: Array<() => void> = [];

  private get maxConcurrent(): number {
    return config.scraper.puppeteerMaxConcurrent;
  }

  private get timeout(): number {
    return config.scraper.puppeteerTimeout;
  }

  /**
   * Resolve the Chrome/Chromium executable path.
   * Priority: env var → system Chrome → cached download → fresh download.
   */
  async resolveExecutablePath(): Promise<string> {
    if (this.resolvedExecutablePath) {
      return this.resolvedExecutablePath;
    }

    // 1. Check env var override
    if (config.scraper.chromeExecutablePath) {
      if (fs.existsSync(config.scraper.chromeExecutablePath)) {
        logger.info(
          { path: config.scraper.chromeExecutablePath },
          "Using Chrome from CHROME_EXECUTABLE_PATH",
        );
        this.resolvedExecutablePath = config.scraper.chromeExecutablePath;
        return this.resolvedExecutablePath;
      }
      logger.warn(
        { path: config.scraper.chromeExecutablePath },
        "CHROME_EXECUTABLE_PATH set but file not found, falling back to auto-detection",
      );
    }

    // 2. Check system Chrome installations
    for (const chromePath of SYSTEM_CHROME_PATHS) {
      if (fs.existsSync(chromePath)) {
        logger.info({ path: chromePath }, "Found system Chrome");
        this.resolvedExecutablePath = chromePath;
        return this.resolvedExecutablePath;
      }
    }

    // 3. Download Chromium using @puppeteer/browsers
    logger.info("No system Chrome found, downloading Chromium...");
    const cacheDir = path.resolve(process.cwd(), ".cache", "puppeteer");

    const platform = detectBrowserPlatform()!;
    const buildId = await resolveBuildId(PuppeteerBrowser.CHROMIUM, platform, "stable");
    const installed = await install({
      browser: PuppeteerBrowser.CHROMIUM,
      buildId,
      cacheDir,
    });

    logger.info({ path: installed.executablePath }, "Chromium downloaded successfully");
    this.resolvedExecutablePath = installed.executablePath;
    return this.resolvedExecutablePath;
  }

  /**
   * Get or launch the singleton browser instance.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser;
    }

    const executablePath = await this.resolveExecutablePath();
    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: BROWSER_LAUNCH_ARGS,
    });

    // Clean up on unexpected disconnect
    this.browser.on("disconnected", () => {
      logger.warn("Browser disconnected unexpectedly");
      this.browser = null;
    });

    logger.info("Headless browser launched");
    return this.browser;
  }

  /**
   * Acquire a concurrency slot.
   * Resolves immediately if under the limit, otherwise waits.
   */
  private async acquireSlot(): Promise<void> {
    if (this.activePages < this.maxConcurrent) {
      this.activePages++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activePages++;
        resolve();
      });
    });
  }

  /**
   * Release a concurrency slot and notify the next waiter.
   */
  private releaseSlot(): void {
    this.activePages--;
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Render a page using a headless browser and return the fully rendered HTML.
   * Executes JavaScript, waits for network idle, then extracts the DOM.
   */
  async renderPage(url: string): Promise<string> {
    await validateUrlForSSRF(url);
    await this.acquireSlot();

    let page: Page | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Block unnecessary resources to speed up rendering
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const resourceType = request.resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          request.abort();
        } else {
          request.continue();
        }
      });

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.timeout,
      });

      const html = await page.content();
      logger.debug({ url, htmlLength: html.length }, "Page rendered successfully");
      return html;
    } finally {
      if (page) {
        await page.close().catch((err) => {
          logger.warn({ err }, "Failed to close page");
        });
      }
      this.releaseSlot();
    }
  }

  /**
   * Gracefully shut down the browser.
   */
  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch((err) => {
        logger.warn({ err }, "Failed to close browser gracefully");
      });
      this.browser = null;
      logger.info("Headless browser shut down");
    }
  }
}

export const headlessBrowserService = new HeadlessBrowserService();

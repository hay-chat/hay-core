import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  install,
  Browser as PuppeteerBrowser,
  resolveBuildId,
  detectBrowserPlatform,
} from "@puppeteer/browsers";
import { createLogger } from "@server/lib/logger";
import { validateUrlForSSRF } from "@server/utils/ssrf";
import { stripHiddenHtml } from "@server/utils/strip-hidden-html";
import { config } from "@server/config/env";
import { lookup } from "dns/promises";
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
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--no-first-run",
  // Keep WebRTC from opening UDP sockets outside request interception.
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
];

const SKIPPED_RESOURCE_TYPES = new Set(["image", "font", "media"]);

/**
 * Decide whether the rendered page may make a request: only http(s) to public
 * addresses, plus inline `data:` / `blob:` content.
 */
export async function allowRequest(url: string, resourceType: string): Promise<boolean> {
  if (SKIPPED_RESOURCE_TYPES.has(resourceType)) return false;
  const protocol = url.slice(0, url.indexOf(":") + 1).toLowerCase();
  if (protocol === "data:" || protocol === "blob:") return true;
  if (protocol !== "http:" && protocol !== "https:") return false;
  try {
    await validateUrlForSSRF(url);
    return true;
  } catch {
    logger.debug({ url }, "Blocked headless browser request");
    return false;
  }
}

/** Runs in every frame before page scripts: removes network APIs interception cannot see. */
const DISABLE_UNINTERCEPTED_NETWORK_APIS = `(() => {
  for (const name of ["WebSocket", "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection"]) {
    try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false }); } catch {}
  }
})();`;

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

    this.browser = config.scraper.chromeRemoteUrl
      ? await this.connectRemoteBrowser(config.scraper.chromeRemoteUrl)
      : await this.launchLocalBrowser();

    // Clean up on unexpected disconnect
    this.browser.on("disconnected", () => {
      logger.warn("Browser disconnected unexpectedly");
      this.browser = null;
    });

    logger.info("Headless browser ready");
    return this.browser;
  }

  private async launchLocalBrowser(): Promise<Browser> {
    const disableSandbox = config.scraper.chromeDisableSandbox;
    if (disableSandbox) {
      logger.warn("Launching Chromium without its sandbox; set CHROME_REMOTE_URL to isolate it");
    }
    return puppeteer.launch({
      executablePath: await this.resolveExecutablePath(),
      headless: true,
      args: disableSandbox ? ["--no-sandbox", ...BROWSER_LAUNCH_ARGS] : BROWSER_LAUNCH_ARGS,
    });
  }

  /**
   * Attach to the configured browser. Never falls back to a local launch: that
   * would quietly put page rendering back inside the app container.
   */
  private async connectRemoteBrowser(remoteUrl: string): Promise<Browser> {
    try {
      const url = new URL(remoteUrl);
      // Chromium's DevTools endpoint rejects a Host header that isn't an IP or localhost.
      const { address } = await lookup(url.hostname, { family: 4 });
      return await puppeteer.connect({ browserURL: `${url.protocol}//${address}:${url.port}` });
    } catch (err) {
      logger.error({ err }, "Remote browser is unreachable");
      throw new Error(
        "The browser service configured in CHROME_REMOTE_URL is unreachable, so this page could not be rendered.",
      );
    }
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

      // Service workers would fetch outside request interception.
      await page.setBypassServiceWorker(true);
      // WebSockets / WebRTC are not covered by request interception either.
      await page.evaluateOnNewDocument(DISABLE_UNINTERCEPTED_NETWORK_APIS);
      // Every request the page makes (subresources, XHR, iframes, redirect hops)
      // is SSRF-checked; images, fonts and media are skipped to speed up rendering.
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        void allowRequest(request.url(), request.resourceType()).then((allowed) =>
          (allowed ? request.continue() : request.abort("blockedbyclient")).catch(() => undefined),
        );
      });

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.timeout,
      });

      const html = stripHiddenHtml(await page.content());
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
      // A remote browser outlives this process; only drop the connection to it.
      const release = config.scraper.chromeRemoteUrl
        ? this.browser.disconnect()
        : this.browser.close();
      await release.catch((err) => {
        logger.warn({ err }, "Failed to close browser gracefully");
      });
      this.browser = null;
      logger.info("Headless browser shut down");
    }
  }
}

export const headlessBrowserService = new HeadlessBrowserService();

/**
 * With CHROME_REMOTE_URL set the service attaches to that browser and never
 * launches one locally, even when the remote one is down.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/utils/ssrf", () => ({ validateUrlForSSRF: jest.fn() }));
jest.mock("@puppeteer/browsers", () => ({}));
const scraper = { chromeRemoteUrl: "http://browser:9223", chromeDisableSandbox: false };
jest.mock("@server/config/env", () => ({
  config: { scraper: { chromeExecutablePath: "/usr/bin/chromium", ...scraper } },
}));
jest.mock("dns/promises", () => ({ lookup: async () => ({ address: "172.20.0.5", family: 4 }) }));

const browser = { connected: true, on: jest.fn(), disconnect: jest.fn(async () => undefined) };
const connect = jest.fn<(options: unknown) => Promise<unknown>>();
const launch = jest.fn();
jest.mock("puppeteer-core", () => ({ __esModule: true, default: { connect, launch } }));

import { HeadlessBrowserService } from "@server/services/headless-browser.service";

type Internals = { getBrowser(): Promise<unknown> };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("remote browser", () => {
  it("connects by IP and disconnects on shutdown without closing the browser", async () => {
    connect.mockResolvedValue(browser);
    const service = new HeadlessBrowserService();

    await (service as unknown as Internals).getBrowser();
    await service.shutdown();

    expect(connect).toHaveBeenCalledWith({ browserURL: "http://172.20.0.5:9223" });
    expect(launch).not.toHaveBeenCalled();
    expect(browser.disconnect).toHaveBeenCalled();
  });

  it("reports an unreachable browser and does not launch one locally", async () => {
    connect.mockRejectedValue(new Error("ECONNREFUSED"));
    const service = new HeadlessBrowserService();

    await expect((service as unknown as Internals).getBrowser()).rejects.toThrow(
      "CHROME_REMOTE_URL",
    );
    expect(launch).not.toHaveBeenCalled();
  });
});

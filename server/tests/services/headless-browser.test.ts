/**
 * Every request a rendered page makes is SSRF-checked, and only http(s) or
 * inline content is allowed.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const mockValidate = jest.fn<(url: string) => Promise<void>>(async () => undefined);
jest.mock("@server/utils/ssrf", () => ({
  validateUrlForSSRF: (url: string) => mockValidate(url),
}));

import { allowRequest } from "@server/services/headless-browser.service";

beforeEach(() => {
  jest.clearAllMocks();
  mockValidate.mockResolvedValue(undefined);
});

describe("allowRequest", () => {
  it("checks subresource, XHR and frame requests against the SSRF guard", async () => {
    await expect(allowRequest("https://cdn.example/app.js", "script")).resolves.toBe(true);
    await expect(allowRequest("https://api.example/data", "xhr")).resolves.toBe(true);
    expect(mockValidate).toHaveBeenCalledWith("https://cdn.example/app.js");
    expect(mockValidate).toHaveBeenCalledWith("https://api.example/data");
  });

  it("aborts requests the SSRF guard refuses", async () => {
    mockValidate.mockRejectedValueOnce(new Error("Blocked request to private/internal IP"));
    await expect(allowRequest("http://169.254.169.254/latest/", "xhr")).resolves.toBe(false);
  });

  it("aborts non-http schemes without checking them", async () => {
    for (const url of ["file:///etc/passwd", "ftp://host/x", "chrome://settings", "ws://h/"]) {
      await expect(allowRequest(url, "document")).resolves.toBe(false);
    }
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it("allows inline content and skips heavy resource types", async () => {
    await expect(allowRequest("data:text/css,body{}", "stylesheet")).resolves.toBe(true);
    await expect(allowRequest("blob:https://site.example/1", "script")).resolves.toBe(true);
    await expect(allowRequest("https://cdn.example/a.png", "image")).resolves.toBe(false);
    expect(mockValidate).not.toHaveBeenCalled();
  });
});

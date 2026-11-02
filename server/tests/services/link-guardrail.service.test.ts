import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

jest.mock("@server/lib/logger", () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { createLogger: () => log };
});

const lookup = jest.fn<(host: string) => Promise<unknown>>();
jest.mock("dns/promises", () => ({
  __esModule: true,
  default: { lookup: (h: string) => lookup(h) },
}));
jest.mock("@server/utils/ssrf", () => ({ validateUrlForSSRF: async () => undefined }));

import {
  LinkGuardrailService,
  checkLink,
  clearLinkStatusCache,
  extractUrls,
  normalizeUrl,
  type LinkStatus,
} from "../../services/core/link-guardrail.service";

describe("extractUrls", () => {
  it("finds markdown and bare links without trailing punctuation", () => {
    const text =
      "See [our sales page](https://shop.com/sales) or https://shop.com/faq. Also <https://x.io/a>, done!";
    expect(extractUrls(text)).toEqual([
      "https://shop.com/sales",
      "https://shop.com/faq",
      "https://x.io/a",
    ]);
  });

  it("reads URLs out of JSON-escaped tool output", () => {
    const json = JSON.stringify({ text: JSON.stringify({ url: "https://shop.com/p/1" }) });
    expect(extractUrls(json)).toEqual(["https://shop.com/p/1"]);
  });

  it("returns nothing for text without links", () => {
    expect(extractUrls("Visit our store at the mall")).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("ignores www, case, trailing slash and fragment", () => {
    expect(normalizeUrl("https://WWW.Shop.com/sales/#top")).toBe(
      normalizeUrl("http://shop.com/sales"),
    );
  });

  it("keeps the query string", () => {
    expect(normalizeUrl("https://shop.com/s?q=1")).not.toBe(normalizeUrl("https://shop.com/s?q=2"));
  });
});

describe("LinkGuardrailService.assessLinks", () => {
  const statuses: Record<string, LinkStatus> = {};
  const check = jest.fn(async (url: string) => statuses[url] ?? "unknown");
  const service = new LinkGuardrailService(check);

  beforeEach(() => {
    check.mockClear();
    for (const key of Object.keys(statuses)) delete statuses[key];
  });

  it("trusts links found in the context without fetching them", async () => {
    const bad = await service.assessLinks({
      response: "Our policy: https://shop.com/returns/",
      contextTexts: ["# Returns\nSource: https://www.shop.com/returns\n..."],
    });
    expect(bad).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });

  it("flags a dead link that is not in the context", async () => {
    statuses["https://shop.com/sales"] = "dead";
    const bad = await service.assessLinks({
      response: "Go to [sales](https://shop.com/sales)",
      contextTexts: [],
    });
    expect(bad).toEqual([{ url: "https://shop.com/sales", reason: "dead" }]);
  });

  it("lets unknown status pass (sites that block bots)", async () => {
    const bad = await service.assessLinks({
      response: "See https://other.com/page",
      contextTexts: [],
    });
    expect(bad).toEqual([]);
  });

  it("flags a live own-site page missing from the site index", async () => {
    statuses["https://shop.com/made-up"] = "live";
    const bad = await service.assessLinks({
      response: "See https://shop.com/made-up",
      contextTexts: [],
      website: "shop.com",
      siteUrls: ["https://shop.com/", "https://shop.com/about"],
    });
    expect(bad).toEqual([{ url: "https://shop.com/made-up", reason: "unlisted" }]);
  });

  it("does not flag own-site pages when there is no site index", async () => {
    statuses["https://shop.com/made-up"] = "live";
    const bad = await service.assessLinks({
      response: "See https://shop.com/made-up",
      contextTexts: [],
      website: "https://shop.com",
    });
    expect(bad).toEqual([]);
  });

  it("trusts the organization's website itself and pages in the site index", async () => {
    const bad = await service.assessLinks({
      response: "Visit https://shop.com or https://shop.com/about",
      contextTexts: [],
      website: "shop.com",
      siteUrls: ["https://shop.com/about"],
    });
    expect(bad).toEqual([]);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("checkLink", () => {
  const fetchMock = jest.fn<typeof fetch>();
  const realFetch = global.fetch;
  const res = (status: number, headers: Record<string, string> = {}) =>
    new Response(null, { status, headers });

  beforeEach(() => {
    clearLinkStatusCache();
    fetchMock.mockReset();
    lookup.mockReset();
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("is live on 200", async () => {
    fetchMock.mockResolvedValue(res(200));
    expect(await checkLink("https://shop.com/a")).toBe("live");
  });

  it("is dead on 404 and 410", async () => {
    fetchMock.mockResolvedValueOnce(res(404));
    expect(await checkLink("https://shop.com/a")).toBe("dead");
    fetchMock.mockResolvedValueOnce(res(410));
    expect(await checkLink("https://shop.com/b")).toBe("dead");
  });

  it("is unknown on 403 and on timeouts", async () => {
    fetchMock.mockResolvedValueOnce(res(403));
    expect(await checkLink("https://shop.com/a")).toBe("unknown");
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await checkLink("https://shop.com/b")).toBe("unknown");
  });

  it("is dead when the host does not exist", async () => {
    lookup.mockRejectedValue(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
    expect(await checkLink("https://made-up-shop.example/a")).toBe("dead");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to GET when HEAD is not allowed", async () => {
    fetchMock.mockResolvedValueOnce(res(405)).mockResolvedValueOnce(res(200));
    expect(await checkLink("https://shop.com/a")).toBe("live");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("GET");
  });

  it("follows redirects, and a deep link redirected to the home page is dead", async () => {
    fetchMock.mockResolvedValueOnce(res(301, { location: "/new" })).mockResolvedValueOnce(res(200));
    expect(await checkLink("https://shop.com/old")).toBe("live");

    fetchMock.mockResolvedValueOnce(res(302, { location: "https://www.shop.com/" }));
    expect(await checkLink("https://shop.com/missing")).toBe("dead");
  });

  it("caches results", async () => {
    fetchMock.mockResolvedValue(res(200));
    await checkLink("https://shop.com/a");
    await checkLink("https://shop.com/a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

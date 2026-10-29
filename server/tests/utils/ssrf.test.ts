/**
 * Outbound requests to untrusted URLs only reach public addresses: every
 * resolved address is checked (IPv4 and IPv6), resolution failures are refused,
 * and the connection is pinned to the checked address.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import dnsPromises from "dns/promises";
import type { LookupAddress } from "dns";
import http from "http";
import type { AddressInfo } from "net";
import {
  isBlockedAddress,
  validateUrlForSSRF,
  ssrfSafeLookup,
  safeFetch,
  SsrfBlockedError,
} from "../../utils/ssrf";

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

function mockLookup(...answers: Array<LookupAddress[] | Error>) {
  const spy = jest.spyOn(dnsPromises, "lookup");
  for (const answer of answers) {
    spy.mockImplementationOnce((async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    }) as unknown as typeof dnsPromises.lookup);
  }
  return spy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:8.8.8.8",
    "64:ff9b::7f00:1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "2001::1",
    "not-an-ip",
    "",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    PUBLIC_V4,
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "100.128.0.1",
    PUBLIC_V6,
    "2a00:1450::1",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("validateUrlForSSRF", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]:8080/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://0177.0.0.1/",
    "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s without DNS", async (url) => {
    const lookup = jest.spyOn(dnsPromises, "lookup");
    await expect(validateUrlForSSRF(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses non-http schemes, credentials and malformed URLs", async () => {
    await expect(validateUrlForSSRF("file:///etc/passwd")).rejects.toThrow(/protocol/);
    await expect(validateUrlForSSRF("gopher://example.com/")).rejects.toThrow(/protocol/);
    await expect(validateUrlForSSRF("http://user:pw@example.com/")).rejects.toThrow(/credentials/);
    await expect(validateUrlForSSRF("not a url")).rejects.toThrow(/invalid URL/);
  });

  it("refuses a host that does not resolve", async () => {
    mockLookup(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    await expect(validateUrlForSSRF("https://nowhere.invalid/")).rejects.toThrow(
      /could not resolve/,
    );
  });

  it("refuses a host that resolves to nothing", async () => {
    mockLookup([]);
    await expect(validateUrlForSSRF("https://empty.example/")).rejects.toThrow(/could not resolve/);
  });

  it("refuses localhost", async () => {
    mockLookup([{ address: "127.0.0.1", family: 4 }]);
    await expect(validateUrlForSSRF("http://localhost:3001/")).rejects.toThrow(/private/);
  });

  it("refuses an IPv6-only host with a private address", async () => {
    mockLookup([{ address: "fd00::5", family: 6 }]);
    await expect(validateUrlForSSRF("https://v6only.example/")).rejects.toThrow(/fd00::5/);
  });

  it("refuses a host when any one of its addresses is private", async () => {
    mockLookup([
      { address: PUBLIC_V4, family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);
    await expect(validateUrlForSSRF("https://mixed.example/")).rejects.toThrow(/10\.0\.0\.7/);
  });

  it("allows a public host and checks every address", async () => {
    const lookup = mockLookup([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ]);
    await expect(validateUrlForSSRF("https://example.com/page")).resolves.toBeUndefined();
    expect(lookup.mock.calls[0]).toEqual(["example.com", expect.objectContaining({ all: true })]);
  });

  it("allows a public IP literal", async () => {
    await expect(validateUrlForSSRF(`http://${PUBLIC_V4}/`)).resolves.toBeUndefined();
  });
});

describe("ssrfSafeLookup", () => {
  function lookup(hostname: string, options: { all?: boolean; family?: number }) {
    return new Promise<{ err: Error | null; address: unknown; family?: number }>((resolve) => {
      ssrfSafeLookup(hostname, options, (err, address, family) =>
        resolve({ err, address, family }),
      );
    });
  }

  it("returns the checked address", async () => {
    mockLookup([{ address: PUBLIC_V4, family: 4 }]);
    await expect(lookup("example.com", {})).resolves.toEqual({
      err: null,
      address: PUBLIC_V4,
      family: 4,
    });
  });

  it("returns every checked address when asked for all", async () => {
    const answer = [
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ];
    mockLookup(answer);
    const result = await lookup("example.com", { all: true });
    expect(result.err).toBeNull();
    expect(result.address).toEqual(answer);
  });

  it("fails the connection when the host resolves privately", async () => {
    mockLookup([{ address: "169.254.169.254", family: 4 }]);
    const result = await lookup("metadata.example", {});
    expect(result.err).toBeInstanceOf(SsrfBlockedError);
  });
});

describe("safeFetch", () => {
  async function withServer(run: (port: number, hits: () => number) => Promise<void>) {
    let count = 0;
    const server = http.createServer((_req, res) => {
      count++;
      res.end("internal");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      await run((server.address() as AddressInfo).port, () => count);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it("never connects to a private IP literal", async () => {
    await withServer(async (port, hits) => {
      await expect(safeFetch(`http://127.0.0.1:${port}/`, { timeoutMs: 2000 })).rejects.toThrow(
        /Blocked/,
      );
      expect(hits()).toBe(0);
    });
  });

  it("pins the connection: a host re-resolving to a private address is refused", async () => {
    await withServer(async (port, hits) => {
      // First answer passes the up-front check; the connect-time lookup then
      // sees the private address and the socket is never opened.
      mockLookup([{ address: PUBLIC_V4, family: 4 }], [{ address: "127.0.0.1", family: 4 }]);
      const error = await safeFetch(`http://rebind.example:${port}/`, { timeoutMs: 2000 }).then(
        () => null,
        (err: Error & { cause?: unknown }) => err,
      );
      expect(String(error?.cause)).toMatch(/Blocked request to private\/internal IP/);
      expect(hits()).toBe(0);
    });
  });

  it("never follows redirects and always sets a timeout", async () => {
    const realFetch = global.fetch;
    const fetchMock = jest.fn(async (_url: string | URL, _init?: RequestInit) => new Response());
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await safeFetch(`https://${PUBLIC_V4}/x`, { method: "POST", timeoutMs: 1000 });
    } finally {
      global.fetch = realFetch;
    }
    const init = fetchMock.mock.calls[0][1] as RequestInit & { dispatcher?: unknown };
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.dispatcher).toBeDefined();
  });
});

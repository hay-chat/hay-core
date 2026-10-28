/**
 * G5: remote files for the evidence PDF (and send_attachment) are fetched
 * SSRF-checked, without redirects, and within a size cap.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import { fetchPublicFile } from "../../utils/fetch-public-file";

const PUBLIC_URL = "https://93.184.216.34/photo.jpg";
const options = { maxBytes: 8, timeoutMs: 1000 };
const realFetch = global.fetch;

function mockFetch(response: Response) {
  const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => response);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("fetchPublicFile", () => {
  it("returns the body and mime type of a public file", async () => {
    const fetchMock = mockFetch(
      new Response(Buffer.from("abc"), { headers: { "content-type": "image/jpeg; q=1" } }),
    );
    const file = await fetchPublicFile(PUBLIC_URL, options);
    expect(file.buffer.toString()).toBe("abc");
    expect(file.mimeType).toBe("image/jpeg");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("refuses a private address before any request", async () => {
    const fetchMock = mockFetch(new Response("x"));
    await expect(fetchPublicFile("http://127.0.0.1/admin", options)).rejects.toThrow(/Blocked/);
    await expect(fetchPublicFile("http://169.254.169.254/latest", options)).rejects.toThrow(
      /Blocked/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect", async () => {
    mockFetch(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }));
    await expect(fetchPublicFile(PUBLIC_URL, options)).rejects.toThrow(/status 302/);
  });

  it("stops reading a body larger than the cap", async () => {
    mockFetch(new Response(Buffer.from("0123456789")));
    await expect(fetchPublicFile(PUBLIC_URL, options)).rejects.toThrow(/too large/);
  });

  it("rejects a declared size over the cap without reading", async () => {
    mockFetch(new Response(Buffer.from("01"), { headers: { "content-length": "999" } }));
    await expect(fetchPublicFile(PUBLIC_URL, options)).rejects.toThrow(/too large/);
  });
});

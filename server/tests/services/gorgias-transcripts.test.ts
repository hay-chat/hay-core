import { describe, it, expect, jest } from "@jest/globals";
import {
  fetchGorgiasTranscripts,
  normalizeGorgiasSubdomain,
} from "../../services/importers/transcripts/gorgias";
import { TranscriptImportError } from "../../services/importers/transcripts/test-transcript";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** D7-8: Gorgias tickets become transcripts; credentials only go to Gorgias. */
describe("Gorgias import", () => {
  it("accepts a subdomain, a host or a URL, and nothing that points elsewhere", () => {
    expect(normalizeGorgiasSubdomain("acme")).toBe("acme");
    expect(normalizeGorgiasSubdomain("https://Acme.gorgias.com/app/tickets")).toBe("acme");
    for (const bad of ["evil.com/x?", "a b", "acme.evil.com", "-acme", "../x", ""]) {
      expect(() => normalizeGorgiasSubdomain(bad)).toThrow(TranscriptImportError);
    }
  });

  it("follows the cursor, skips internal notes and maps from_agent to roles", async () => {
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      calls.push(href);
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from("me@shop.com:key").toString("base64")}`,
      );
      if (href.includes("/tickets?") && !href.includes("cursor=")) {
        return json({ data: [{ id: 1 }], meta: { next_cursor: "c2" } });
      }
      if (href.includes("/tickets?"))
        return json({ data: [{ id: 2 }], meta: { next_cursor: null } });
      const id = href.endsWith("/1") ? 1 : 2;
      return json({
        id,
        subject: `Ticket ${id}`,
        messages: [
          { from_agent: true, stripped_text: "Sorry!", created_datetime: "2026-10-01T10:02:00Z" },
          { from_agent: false, body_text: "Late order", created_datetime: "2026-10-01T10:00:00Z" },
          {
            from_agent: true,
            public: false,
            body_text: "internal",
            created_datetime: "2026-10-01T10:01:00Z",
          },
        ],
      });
    });

    const transcripts = await fetchGorgiasTranscripts(
      { subdomain: "acme", email: "me@shop.com", apiKey: "key", limit: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(calls.every((c) => c.startsWith("https://acme.gorgias.com/api/"))).toBe(true);
    expect(transcripts.map((t) => t.externalId)).toEqual(["1", "2"]);
    expect(transcripts[0]).toMatchObject({ title: "Ticket 1" });
    expect(transcripts[0].turns.map((t) => [t.role, t.text])).toEqual([
      ["customer", "Late order"],
      ["agent", "Sorry!"],
    ]);
  });

  it("explains refused credentials", async () => {
    const fetchImpl = jest.fn(async () => json({}, 401));
    await expect(
      fetchGorgiasTranscripts(
        { subdomain: "acme", email: "me@shop.com", apiKey: "bad", limit: 5 },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/refused the email and API key/);
  });

  it("F10: waits out 429s using Retry-After, then gives up after a few", async () => {
    let listCalls = 0;
    const fetchImpl = jest.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/tickets?")) {
        listCalls++;
        if (listCalls === 1) {
          return new Response("{}", { status: 429, headers: { "Retry-After": "3" } });
        }
        return json({ data: [{ id: 7 }], meta: { next_cursor: null } });
      }
      return json({ id: 7, messages: [{ from_agent: false, body_text: "Hi" }] });
    });
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const transcripts = await fetchGorgiasTranscripts(
      { subdomain: "acme", email: "me@shop.com", apiKey: "key" },
      fetchImpl as unknown as typeof fetch,
      sleep,
    );
    expect(transcripts.map((t) => t.externalId)).toEqual(["7"]);
    expect(waits).toEqual([3000]);

    const alwaysLimited = jest.fn(async () => new Response("{}", { status: 429 }));
    const limitedWaits: number[] = [];
    await expect(
      fetchGorgiasTranscripts(
        { subdomain: "acme", email: "me@shop.com", apiKey: "key" },
        alwaysLimited as unknown as typeof fetch,
        async (ms) => {
          limitedWaits.push(ms);
        },
      ),
    ).rejects.toThrow(/kept rate limiting/);
    expect(limitedWaits).toEqual([20_000, 20_000, 20_000, 20_000, 20_000]);
  });
});

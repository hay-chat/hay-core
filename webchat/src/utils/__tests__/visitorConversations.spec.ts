import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listMyConversations } from "../visitorConversations";
import { grantConsent, initConsent, markInteraction } from "@/composables/useConsent";

/**
 * "Your conversations" asks `publicConversations.listMine` only after consent,
 * with one DPoP proof per stored conversation key (no nonce: listing must not
 * spend the conversations' nonces) and the signed customer id when there is one.
 */

const keys = vi.hoisted(() => ({
  list: [] as Array<{ conversationId: string; createdAt: Date }>,
}));

vi.mock("@/composables/useDPoP", () => ({
  listKeypairs: vi.fn(async () =>
    keys.list.map((key) => ({
      ...key,
      privateKey: {} as CryptoKey,
      publicKey: {} as CryptoKey,
      publicJwk: { kty: "EC" },
    })),
  ),
  createDPoPProof: vi.fn(
    async (_method: string, _url: string, _key: unknown, _jwk: unknown, nonce?: string) =>
      nonce ? "proof-with-nonce" : "proof",
  ),
  clearAllKeypairs: vi.fn(async () => {}),
}));

const config = { organizationId: "org-1", baseUrl: "https://api.example.test" };
const row = {
  id: "c-1",
  status: "open",
  lastMessagePreview: "Hi",
  lastMessageAt: "2026-11-01T10:00:00.000Z",
  lastSenderName: null,
  resumable: true,
};

describe("listMyConversations", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    initConsent("implicit");
    keys.list = [
      { conversationId: "c-old", createdAt: new Date("2026-10-01") },
      { conversationId: "c-1", createdAt: new Date("2026-11-01") },
    ];
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { data: [row] } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("asks nothing before consent", async () => {
    expect(await listMyConversations(config)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one nonce-less proof per stored key, newest first", async () => {
    grantConsent();
    expect(await listMyConversations(config)).toEqual([row]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/v1/publicConversations.listMine");
    expect(JSON.parse(init.body)).toEqual({
      organizationId: "org-1",
      conversations: [
        { conversationId: "c-1", proof: "proof" },
        { conversationId: "c-old", proof: "proof" },
      ],
    });
  });

  it("adds the signed customer id, and asks even without stored keys", async () => {
    markInteraction();
    keys.list = [];
    await listMyConversations({
      ...config,
      customerExternalId: "cust-9",
      customerExternalIdSignature: "sig",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      conversations: [],
      customerExternalId: "cust-9",
      customerExternalIdSignature: "sig",
    });
  });

  it("asks nothing with no keys and no signed customer", async () => {
    markInteraction();
    keys.list = [];
    expect(await listMyConversations(config)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists nothing when the server refuses", async () => {
    grantConsent();
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await listMyConversations(config)).toEqual([]);
  });
});

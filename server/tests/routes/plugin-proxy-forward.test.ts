jest.mock("@server/services/plugin-manager.service", () => ({ pluginManagerService: {} }));
jest.mock("@server/services/plugin-instance-manager.service", () => ({
  pluginInstanceManagerService: {},
}));
jest.mock("@server/services/webhook-router.service", () => ({ webhookRouterService: {} }));
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: {},
}));

import type { Request } from "express";
import { buildWorkerForward } from "../../routes/v1/plugins/proxy";

type FakeRequest = {
  method?: string;
  rawBody?: string;
  headers?: Record<string, string>;
};

function fakeRequest(overrides: FakeRequest): Request {
  const headers: Record<string, string> = {
    host: "api.hay.chat",
    "content-type": "application/json",
    ...overrides.headers,
  };
  return {
    method: overrides.method ?? "POST",
    protocol: "http",
    originalUrl: "/v1/plugins/p/webhook?organizationId=org",
    body: { parsed: true },
    rawBody: overrides.rawBody,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

describe("buildWorkerForward", () => {
  it("forwards the raw bytes verbatim under the original content type", () => {
    const raw = '{"a": 1,  "emoji": "🙂"}';
    const { headers, body } = buildWorkerForward(
      fakeRequest({
        rawBody: raw,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      4321,
    );

    expect(body).toBe(raw);
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.host).toBe("localhost:4321");
    expect(headers["x-original-body-base64"]).toBeUndefined();
    expect(headers["x-original-content-type"]).toBeUndefined();
  });

  it("passes a multi-megabyte body through without touching headers", () => {
    const raw = JSON.stringify({ entry: "x".repeat(2_500_000) });
    const { headers, body } = buildWorkerForward(fakeRequest({ rawBody: raw }), 1);

    expect(body).toHaveLength(raw.length);
    expect(Object.values(headers).every((v) => v.length < 1024)).toBe(true);
  });

  it("re-encodes the parsed body as JSON only when no raw body was captured", () => {
    const { headers, body } = buildWorkerForward(
      fakeRequest({ headers: { "content-type": "text/plain" } }),
      1,
    );

    expect(body).toBe('{"parsed":true}');
    expect(headers["content-type"]).toBe("application/json");
  });

  it("carries the external URL and strips credential headers", () => {
    const { headers } = buildWorkerForward(
      fakeRequest({
        rawBody: "{}",
        headers: {
          authorization: "Bearer secret",
          cookie: "session=1",
          "content-length": "2",
          "x-forwarded-proto": "https",
          "x-chatwoot-signature": "sha256=abc",
        },
      }),
      1,
    );

    expect(headers["x-original-url"]).toBe(
      "https://api.hay.chat/v1/plugins/p/webhook?organizationId=org",
    );
    expect(headers.authorization).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
    expect(headers["x-chatwoot-signature"]).toBe("sha256=abc");
  });

  it("sends no body for GET", () => {
    const { headers, body } = buildWorkerForward(fakeRequest({ method: "GET", rawBody: "{}" }), 1);

    expect(body).toBeUndefined();
    expect(headers["x-original-url"]).toBeUndefined();
  });
});

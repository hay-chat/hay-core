import { afterEach, describe, expect, it, vi } from "vitest";
import { HayApi, type LoginResponse } from "../src/api";

const LOGIN: LoginResponse = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  user: { activeOrganizationId: "org-1", organizations: [{ id: "org-1", name: "Demo" }] },
};

const trpc = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { result: { data } } : data), { status });

const unauthorized = () =>
  trpc({ error: { message: "nope", data: { code: "UNAUTHORIZED" } } }, 401);

const paths = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HayApi credential login", () => {
  const credentials = { email: "demo@hay.chat", password: "pw" };

  it("logs in with the credentials when there is no session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(trpc(LOGIN)).mockResolvedValueOnce(trpc("me"));
    vi.stubGlobal("fetch", fetchMock);
    const onLogin = vi.fn();
    const api = new HayApi({ profile: { baseUrl: "https://x" }, credentials, onLogin });

    await expect(api.query("auth.me")).resolves.toBe("me");
    expect(paths(fetchMock)).toEqual(["/v1/auth.login", "/v1/auth.me"]);
    expect(onLogin).toHaveBeenCalledWith("demo@hay.chat", LOGIN, "org-1");
    const headers = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-1");
    expect(headers["x-organization-id"]).toBe("org-1");
  });

  it("logs in again when the refresh token is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(trpc(LOGIN))
      .mockResolvedValueOnce(trpc("me"));
    vi.stubGlobal("fetch", fetchMock);
    const api = new HayApi({
      profile: { baseUrl: "https://x", refreshToken: "stale" },
      credentials,
    });

    await expect(api.query("auth.me")).resolves.toBe("me");
    expect(paths(fetchMock)).toEqual(["/v1/auth.refreshToken", "/v1/auth.login", "/v1/auth.me"]);
  });

  it("asks for `hay login` without credentials", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const api = new HayApi({ profile: { baseUrl: "https://x" } });
    await expect(api.query("auth.me")).rejects.toThrow("NOT_LOGGED_IN");
  });
});

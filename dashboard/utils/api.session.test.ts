import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observable } from "@trpc/server/observable";

interface FakeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const authStore = {
  tokens: null as FakeTokens | null,
  refreshTokens: vi.fn<() => Promise<void>>(),
  logout: vi.fn(),
};

vi.mock("@/stores/auth", () => ({ useAuthStore: () => authStore }));
vi.mock("@/stores/user", () => ({ useUserStore: () => ({}) }));
vi.mock("@/composables/useServerStatus", () => ({ reportServerError: vi.fn() }));
vi.mock("@/composables/useSuspension", () => ({
  redirectForSuspension: vi.fn(),
  SUSPENDED_ROUTE: "/suspended",
}));

const unauthorized = () => ({
  message: "Token has expired",
  data: { code: "UNAUTHORIZED", httpStatus: 401 },
});
const serverError = () => ({
  message: "boom",
  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
});

const MIN = 60_000;
const tokensExpiringIn = (ms: number): FakeTokens => ({
  accessToken: "access-old",
  refreshToken: "hrt1.old",
  expiresAt: Date.now() + ms,
});

/** A refresh that rotates the store's tokens, like the real store action. */
const rotate = async () => {
  authStore.tokens = {
    accessToken: "access-new",
    refreshToken: "hrt1.new",
    expiresAt: Date.now() + 15 * MIN,
  };
};

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

/**
 * Run one operation through tokenRefreshLink. `responses` are what the
 * downstream link answers on each call (an error object or a value).
 */
async function runThroughLink(
  responses: Array<{ error: unknown } | { value: unknown }>,
): Promise<{ outcome: Outcome; downstreamCalls: number; accessTokensSent: string[] }> {
  const { tokenRefreshLink } = await import("./api");
  let downstreamCalls = 0;
  const accessTokensSent: string[] = [];

  const next = () =>
    observable((observer) => {
      accessTokensSent.push(authStore.tokens?.accessToken ?? "");
      const response = responses[downstreamCalls++];
      if ("error" in response) observer.error(response.error as never);
      else {
        observer.next({ result: { type: "data", data: response.value } } as never);
        observer.complete();
      }
      return () => {};
    });

  const link = (
    tokenRefreshLink as unknown as (runtime: object) => (opts: object) => {
      subscribe: (o: object) => unknown;
    }
  )({});

  const outcome = await new Promise<Outcome>((resolve) => {
    link({
      op: { id: 1, type: "query", path: "conversations.list", input: undefined, context: {} },
      next,
    }).subscribe({
      next: (value: unknown) => resolve({ ok: true, value }),
      error: (error: unknown) => resolve({ ok: false, error }),
    });
  });

  return { outcome, downstreamCalls, accessTokensSent };
}

describe("dashboard session refresh (D11-4)", () => {
  beforeEach(() => {
    vi.resetModules();
    authStore.tokens = null;
    authStore.refreshTokens.mockReset();
    authStore.logout.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("ensureFreshAccessToken", () => {
    it("does nothing while the access token is comfortably valid", async () => {
      const { ensureFreshAccessToken } = await import("./api");
      authStore.tokens = tokensExpiringIn(10 * MIN);
      await ensureFreshAccessToken();
      expect(authStore.refreshTokens).not.toHaveBeenCalled();
    });

    it("refreshes once for many concurrent requests", async () => {
      const { ensureFreshAccessToken } = await import("./api");
      authStore.tokens = tokensExpiringIn(-MIN);
      authStore.refreshTokens.mockImplementation(rotate);

      await Promise.all([
        ensureFreshAccessToken(),
        ensureFreshAccessToken(),
        ensureFreshAccessToken(),
      ]);

      expect(authStore.refreshTokens).toHaveBeenCalledTimes(1);
      expect(authStore.tokens?.refreshToken).toBe("hrt1.new");
    });

    it("keeps the session when the refresh keeps failing on the network", async () => {
      vi.useFakeTimers();
      const { ensureFreshAccessToken } = await import("./api");
      authStore.tokens = tokensExpiringIn(-MIN);
      authStore.refreshTokens.mockRejectedValue(new TypeError("Failed to fetch"));

      const result = ensureFreshAccessToken().catch((error) => error);
      await vi.runAllTimersAsync();
      const error = await result;

      expect((error as Error).name).toBe("SessionRefreshUnavailableError");
      expect(authStore.refreshTokens).toHaveBeenCalledTimes(5); // 1 + 4 backoff retries
      await vi.runAllTimersAsync();
      expect(authStore.logout).not.toHaveBeenCalled();
      expect(authStore.tokens?.refreshToken).toBe("hrt1.old");
    });

    it("lets a request through on a still-valid token when the refresh cannot reach the server", async () => {
      vi.useFakeTimers();
      const { ensureFreshAccessToken } = await import("./api");
      authStore.tokens = tokensExpiringIn(5 * MIN);
      authStore.refreshTokens.mockRejectedValue(serverError());

      const result = ensureFreshAccessToken(10 * MIN);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBeUndefined();
      expect(authStore.logout).not.toHaveBeenCalled();
    });

    it("logs out when the server rejects the refresh token", async () => {
      vi.useFakeTimers();
      const { ensureFreshAccessToken } = await import("./api");
      authStore.tokens = tokensExpiringIn(-MIN);
      authStore.refreshTokens.mockRejectedValue(unauthorized());

      await expect(ensureFreshAccessToken()).rejects.toMatchObject({
        data: { code: "UNAUTHORIZED" },
      });
      await vi.runAllTimersAsync();

      expect(authStore.refreshTokens).toHaveBeenCalledTimes(1);
      expect(authStore.logout).toHaveBeenCalledWith("token_expired");
    });
  });

  describe("tokenRefreshLink", () => {
    it("refreshes and retries once when a request comes back UNAUTHORIZED", async () => {
      authStore.tokens = tokensExpiringIn(10 * MIN);
      authStore.refreshTokens.mockImplementation(rotate);

      const { outcome, downstreamCalls, accessTokensSent } = await runThroughLink([
        { error: unauthorized() },
        { value: ["ok"] },
      ]);

      expect(outcome.ok).toBe(true);
      expect(downstreamCalls).toBe(2);
      expect(accessTokensSent).toEqual(["access-old", "access-new"]);
      expect(authStore.logout).not.toHaveBeenCalled();
    });

    it("does not retry twice: a second UNAUTHORIZED is passed to the caller, without logout", async () => {
      authStore.tokens = tokensExpiringIn(10 * MIN);
      authStore.refreshTokens.mockImplementation(rotate);

      const { outcome, downstreamCalls } = await runThroughLink([
        { error: unauthorized() },
        { error: unauthorized() },
      ]);

      expect(outcome.ok).toBe(false);
      expect(downstreamCalls).toBe(2);
      expect(authStore.refreshTokens).toHaveBeenCalledTimes(1);
      expect(authStore.logout).not.toHaveBeenCalled();
    });

    it("logs out when the refresh behind a 401 is rejected", async () => {
      vi.useFakeTimers();
      authStore.tokens = tokensExpiringIn(10 * MIN);
      authStore.refreshTokens.mockRejectedValue(unauthorized());
      await import("./api"); // load before advancing the fake clock

      const run = runThroughLink([{ error: unauthorized() }]);
      await vi.advanceTimersByTimeAsync(1000);
      const { outcome, downstreamCalls } = await run;
      await vi.runAllTimersAsync();

      expect(outcome.ok).toBe(false);
      expect(downstreamCalls).toBe(1);
      expect(authStore.logout).toHaveBeenCalledTimes(1);
    });

    it("never refreshes or logs out on a 5xx or network error", async () => {
      authStore.tokens = tokensExpiringIn(10 * MIN);

      const fiveHundred = await runThroughLink([{ error: serverError() }]);
      const network = await runThroughLink([{ error: { message: "Failed to fetch" } }]);

      expect(fiveHundred.outcome.ok).toBe(false);
      expect(network.outcome.ok).toBe(false);
      expect(authStore.refreshTokens).not.toHaveBeenCalled();
      expect(authStore.logout).not.toHaveBeenCalled();
    });

    it("fails the request but keeps the session when the token expired and the network is down", async () => {
      vi.useFakeTimers();
      authStore.tokens = tokensExpiringIn(-MIN);
      authStore.refreshTokens.mockRejectedValue(new TypeError("Failed to fetch"));
      await import("./api"); // load before advancing the fake clock

      const run = runThroughLink([{ value: "never sent" }]);
      await vi.advanceTimersByTimeAsync(30_000);
      const { outcome, downstreamCalls } = await run;

      expect(outcome.ok).toBe(false);
      expect(downstreamCalls).toBe(0); // an expired token is not sent to get a 401
      expect(authStore.logout).not.toHaveBeenCalled();
      expect(authStore.tokens?.refreshToken).toBe("hrt1.old");
    });

    it("sends unauthenticated requests untouched", async () => {
      const { outcome, downstreamCalls } = await runThroughLink([{ value: "public" }]);
      expect(outcome.ok).toBe(true);
      expect(downstreamCalls).toBe(1);
      expect(authStore.refreshTokens).not.toHaveBeenCalled();
    });
  });
});

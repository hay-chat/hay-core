import { describe, expect, it, vi } from "vitest";
import {
  createRefreshCoordinator,
  isDefinitiveAuthFailure,
  SessionEndedError,
  SessionRefreshUnavailableError,
} from "./session-refresh";

const unauthorized = () =>
  Object.assign(new Error("Invalid or expired refresh token"), {
    data: { code: "UNAUTHORIZED", httpStatus: 401 },
  });
const serverError = () =>
  Object.assign(new Error("Could not refresh"), {
    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
  });
const networkError = () => new TypeError("Failed to fetch");

function setup(overrides: Partial<Parameters<typeof createRefreshCoordinator>[0]> = {}) {
  const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const onAuthFailure = vi.fn();
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  const coordinator = createRefreshCoordinator({
    refresh,
    onAuthFailure,
    sleep,
    isOnline: () => true,
    waitForOnline: () => Promise.resolve(),
    ...overrides,
  });
  return { coordinator, refresh, onAuthFailure, sleep };
}

describe("isDefinitiveAuthFailure", () => {
  it("is true only for a server UNAUTHORIZED/401 or an ended session", () => {
    expect(isDefinitiveAuthFailure(unauthorized())).toBe(true);
    expect(isDefinitiveAuthFailure({ data: { httpStatus: 401 } })).toBe(true);
    expect(isDefinitiveAuthFailure(new SessionEndedError())).toBe(true);

    expect(isDefinitiveAuthFailure(networkError())).toBe(false);
    expect(isDefinitiveAuthFailure(serverError())).toBe(false);
    expect(isDefinitiveAuthFailure({ data: { httpStatus: 503 } })).toBe(false);
    expect(isDefinitiveAuthFailure({ data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } })).toBe(
      false,
    );
    expect(isDefinitiveAuthFailure(new DOMException("timeout", "AbortError"))).toBe(false);
    expect(isDefinitiveAuthFailure(undefined)).toBe(false);
  });
});

describe("createRefreshCoordinator", () => {
  it("shares one in-flight refresh between concurrent callers", async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { coordinator } = setup({ refresh });

    const calls = [coordinator.refresh(), coordinator.refresh(), coordinator.refresh()];
    expect(coordinator.isRefreshing).toBe(true);
    finish();
    await Promise.all(calls);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(coordinator.isRefreshing).toBe(false);
  });

  it("retries a network error with backoff and never logs out", async () => {
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce(undefined);
    const { coordinator, onAuthFailure, sleep } = setup({ refresh });

    await expect(coordinator.refresh()).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("gives up with SessionRefreshUnavailableError on persistent 5xx, keeping the session", async () => {
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValue(serverError());
    const { coordinator, onAuthFailure, sleep } = setup({ refresh, retryDelaysMs: [10, 20] });

    await expect(coordinator.refresh()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("logs out at once, without retrying, when the refresh is rejected", async () => {
    const rejection = unauthorized();
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValue(rejection);
    const { coordinator, onAuthFailure, sleep } = setup({ refresh });

    await expect(coordinator.refresh()).rejects.toBe(rejection);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledWith(rejection);
  });

  it("logs out once when concurrent callers share a rejected refresh", async () => {
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValue(unauthorized());
    const { coordinator, onAuthFailure } = setup({ refresh });

    const results = await Promise.allSettled([coordinator.refresh(), coordinator.refresh()]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("treats an ended session (no refresh token left) as definitive", async () => {
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValue(new SessionEndedError());
    const { coordinator, onAuthFailure } = setup({ refresh });
    await expect(coordinator.refresh()).rejects.toBeInstanceOf(SessionEndedError);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("waits for the network to come back before refreshing", async () => {
    let online = false;
    const waitForOnline = vi.fn(async () => {
      online = true;
    });
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { coordinator } = setup({ refresh, isOnline: () => online, waitForOnline });

    await coordinator.refresh();

    expect(waitForOnline).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not attempt a refresh, nor log out, while the device stays offline", async () => {
    const refresh = vi.fn<() => Promise<void>>();
    const { coordinator, onAuthFailure } = setup({ refresh, isOnline: () => false });

    await expect(coordinator.refresh()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);

    expect(refresh).not.toHaveBeenCalled();
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it("starts a fresh attempt on the next call after giving up", async () => {
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(undefined);
    const { coordinator } = setup({ refresh, retryDelaysMs: [] });

    await expect(coordinator.refresh()).rejects.toBeInstanceOf(SessionRefreshUnavailableError);
    await expect(coordinator.refresh()).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

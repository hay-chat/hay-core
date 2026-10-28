import { describe, it, expect, jest, beforeEach } from "@jest/globals";

jest.mock("@server/config/env", () => ({
  config: { underAttack: { createThreshold: 30, windowSeconds: 300, hours: 4 } },
}));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn() }),
}));

const mockFindOne = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockUpdate = jest.fn<(...args: unknown[]) => Promise<{ affected?: number }>>();
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ findOne: mockFindOne, update: mockUpdate }) },
}));

const mockRepoUpdate = jest.fn<(orgId: string, data: Record<string, unknown>) => Promise<unknown>>(
  async (_orgId, data) => data,
);
jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: { update: mockRepoUpdate },
}));

const mockCheck = jest.fn<(...args: unknown[]) => Promise<{ limited: boolean }>>();
jest.mock("@server/services/rate-limit.service", () => ({
  rateLimitService: { checkKeyRateLimit: mockCheck },
}));

import {
  isUnderAttack,
  recordCreateAttempt,
  setUnderAttack,
  stateOf,
} from "@server/services/webchat/under-attack.service";

const ORG = "org-1";
const HOUR = 60 * 60 * 1000;

describe("under-attack mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({ affected: 1 });
  });

  it("is active only while the end time is in the future", () => {
    const future = new Date(Date.now() + HOUR);
    expect(stateOf({ underAttackUntil: future, underAttackSource: "auto" })).toEqual({
      active: true,
      until: future.toISOString(),
      source: "auto",
    });
    expect(
      stateOf({ underAttackUntil: new Date(Date.now() - 1000), underAttackSource: "owner" }),
    ).toEqual({ active: false, until: null, source: null });
    expect(stateOf(null).active).toBe(false);
  });

  it("reads the org's settings", async () => {
    mockFindOne.mockResolvedValueOnce({ underAttackUntil: new Date(Date.now() + HOUR) });
    expect(await isUnderAttack(ORG)).toBe(true);
    expect(await isUnderAttack(ORG)).toBe(false);
  });

  it("owner toggle starts a full period and can switch it off", async () => {
    const on = await setUnderAttack(ORG, true);
    expect(on.active).toBe(true);
    expect(on.source).toBe("owner");
    const until = new Date(on.until!).getTime();
    expect(until).toBeGreaterThan(Date.now() + 4 * HOUR - 5000);
    expect(until).toBeLessThanOrEqual(Date.now() + 4 * HOUR);

    const off = await setUnderAttack(ORG, false);
    expect(off.active).toBe(false);
    expect(mockRepoUpdate).toHaveBeenLastCalledWith(ORG, {
      underAttackUntil: null,
      underAttackSource: null,
    });
  });

  it("below the threshold it only counts the attempt", async () => {
    mockCheck.mockResolvedValueOnce({ limited: false });
    expect(await recordCreateAttempt(ORG)).toBe(false);
    expect(mockCheck).toHaveBeenCalledWith(`under-attack:creates:${ORG}`, 30, 300);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("past the threshold it switches on automatically", async () => {
    mockCheck.mockResolvedValueOnce({ limited: true });
    expect(await recordCreateAttempt(ORG)).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [where, data] = mockUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(where.organizationId).toBe(ORG);
    expect(data.underAttackSource).toBe("auto");
    expect((data.underAttackUntil as Date).getTime()).toBeGreaterThan(Date.now() + 3.9 * HOUR);
  });

  it("reports an owner-started period even below the threshold", async () => {
    mockCheck.mockResolvedValueOnce({ limited: false });
    mockFindOne.mockResolvedValueOnce({
      underAttackUntil: new Date(Date.now() + HOUR),
      underAttackSource: "owner",
    });
    expect(await recordCreateAttempt(ORG)).toBe(true);
  });
});

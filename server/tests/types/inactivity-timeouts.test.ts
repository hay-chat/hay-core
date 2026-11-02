import { describe, it, expect } from "@jest/globals";
import {
  DEFAULT_INACTIVITY_TIMEOUTS,
  isValidInactivityTimeout,
  resolveInactivityThresholds,
} from "../../types/organization-settings.types";

const MIN = 60_000;
const FALLBACK = 30 * MIN;

describe("resolveInactivityThresholds", () => {
  it.each([
    ["web", 15, 30],
    ["whatsapp", 60, 120],
    ["messenger", 60, 120],
    ["instagram", 60, 120],
    ["email", 24 * 60, 48 * 60],
  ])("uses the built-in default for %s", (channel, warn, close) => {
    expect(resolveInactivityThresholds(null, channel, FALLBACK)).toEqual({
      warningMs: warn * MIN,
      closeMs: close * MIN,
      silentCloseMs: close * 2 * MIN,
    });
  });

  it("falls back to the env interval (warning at half) for unknown channels", () => {
    expect(resolveInactivityThresholds({}, "sms", FALLBACK)).toEqual({
      warningMs: 15 * MIN,
      closeMs: 30 * MIN,
      silentCloseMs: 60 * MIN,
    });
  });

  it("prefers a valid organization override, for listed and unlisted channels", () => {
    const settings = {
      inactivityTimeouts: {
        email: { warningMinutes: 60, closeMinutes: 180 },
        sms: { warningMinutes: 5, closeMinutes: 10 },
      },
    };
    expect(resolveInactivityThresholds(settings, "email", FALLBACK).closeMs).toBe(180 * MIN);
    expect(resolveInactivityThresholds(settings, "sms", FALLBACK).warningMs).toBe(5 * MIN);
    expect(resolveInactivityThresholds(settings, "whatsapp", FALLBACK).closeMs).toBe(120 * MIN);
  });

  it("ignores a corrupt override and uses the default", () => {
    const settings = { inactivityTimeouts: { web: { warningMinutes: 90, closeMinutes: 30 } } };
    expect(resolveInactivityThresholds(settings, "web", FALLBACK).closeMs).toBe(30 * MIN);
  });

  it("keeps every default valid and WhatsApp's inside its 24 h window", () => {
    for (const timeout of Object.values(DEFAULT_INACTIVITY_TIMEOUTS)) {
      expect(isValidInactivityTimeout(timeout)).toBe(true);
    }
    expect(DEFAULT_INACTIVITY_TIMEOUTS.whatsapp.closeMinutes).toBeLessThan(24 * 60);
  });
});

describe("isValidInactivityTimeout", () => {
  it.each([
    [{ warningMinutes: 10, closeMinutes: 10 }, false],
    [{ warningMinutes: 0, closeMinutes: 10 }, false],
    [{ warningMinutes: 1.5, closeMinutes: 10 }, false],
    [{ warningMinutes: 10, closeMinutes: 14 * 24 * 60 + 1 }, false],
    [{ warningMinutes: "10", closeMinutes: 20 }, false],
    [null, false],
    [{ warningMinutes: 10, closeMinutes: 20 }, true],
  ])("%j -> %s", (value, expected) => {
    expect(isValidInactivityTimeout(value)).toBe(expected);
  });
});

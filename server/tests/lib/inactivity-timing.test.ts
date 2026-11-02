import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  WEB_INACTIVITY,
  isValidInactivityTiming,
  resolveInactivityThresholds,
} from "@server/lib/inactivity-timing";

const MIN = 60_000;
const FALLBACK = 30 * MIN;

describe("resolveInactivityThresholds", () => {
  it("uses the declared timing, with no check-in when warningMinutes is left out", () => {
    expect(
      resolveInactivityThresholds({ warningMinutes: 60, closeMinutes: 120 }, FALLBACK),
    ).toEqual({ warningMs: 60 * MIN, closeMs: 120 * MIN, silentCloseMs: 240 * MIN });
    expect(resolveInactivityThresholds({ closeMinutes: 2880 }, FALLBACK)).toEqual({
      warningMs: null,
      closeMs: 2880 * MIN,
      silentCloseMs: 5760 * MIN,
    });
  });

  it("falls back to the env interval, checking in at half, when nothing is declared", () => {
    expect(resolveInactivityThresholds(undefined, FALLBACK)).toEqual({
      warningMs: 15 * MIN,
      closeMs: 30 * MIN,
      silentCloseMs: 60 * MIN,
    });
  });
});

describe("isValidInactivityTiming", () => {
  it.each([
    [{ warningMinutes: 10, closeMinutes: 10 }, false],
    [{ warningMinutes: 0, closeMinutes: 10 }, false],
    [{ warningMinutes: 1.5, closeMinutes: 10 }, false],
    [{ warningMinutes: 10, closeMinutes: 14 * 24 * 60 + 1 }, false],
    [{ warningMinutes: "10", closeMinutes: 20 }, false],
    [{ warningMinutes: null, closeMinutes: 20 }, false],
    [{ closeMinutes: 0 }, false],
    [null, false],
    [{ warningMinutes: 10, closeMinutes: 20 }, true],
    [{ closeMinutes: 20 }, true],
  ])("%j -> %s", (value, expected) => {
    expect(isValidInactivityTiming(value)).toBe(expected);
  });
});

describe("declared channel timing", () => {
  const pluginsDir = path.resolve(__dirname, "../../../plugins/core");
  const declared = fs
    .readdirSync(pluginsDir)
    .map((dir) => path.join(pluginsDir, dir, "package.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => JSON.parse(fs.readFileSync(file, "utf8"))["hay-plugin"])
    .filter((manifest) => manifest?.inactivity !== undefined)
    .map((manifest) => [manifest.channel as string, manifest.inactivity] as const);

  it("is valid in every core channel plugin, and webchat's is too", () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const [, timing] of declared) expect(isValidInactivityTiming(timing)).toBe(true);
    expect(isValidInactivityTiming(WEB_INACTIVITY)).toBe(true);
  });

  it("closes WhatsApp with a sign-off inside Meta's 24 h reply window", () => {
    const whatsapp = declared.find(([channel]) => channel === "whatsapp")?.[1];
    expect(whatsapp?.closeMinutes).toBeLessThan(24 * 60);
  });
});

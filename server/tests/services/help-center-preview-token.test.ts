/**
 * Preview tokens let the dashboard show a help center that is not live. They
 * are bound to one help center and expire after an hour.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "help-center-preview-test-secret-0123456789";
process.env.HELP_CENTER_DOMAIN = "help.test";

import "reflect-metadata";
import { describe, it, expect } from "@jest/globals";
import type { HelpCenter } from "../../database/entities/help-center.entity";
import {
  customDomainRecords,
  resolveTheme,
  signPreviewToken,
  verifyPreviewToken,
} from "../../services/help-center/help-center.service";

const HELP_CENTER_ID = "7c000000-0000-4000-8000-0000000000a1";
const OTHER_HELP_CENTER_ID = "7c000000-0000-4000-8000-0000000000b2";
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const MINUTE = 60_000;

describe("help center preview tokens", () => {
  it("verifies a fresh token for its help center", () => {
    expect(verifyPreviewToken(HELP_CENTER_ID, signPreviewToken(HELP_CENTER_ID))).toBe(true);
    expect(verifyPreviewToken(HELP_CENTER_ID, signPreviewToken(HELP_CENTER_ID, NOW), NOW)).toBe(
      true,
    );
  });

  it("is refused for another help center", () => {
    const token = signPreviewToken(HELP_CENTER_ID, NOW);
    expect(verifyPreviewToken(OTHER_HELP_CENTER_ID, token, NOW)).toBe(false);
  });

  it("lasts an hour and no longer", () => {
    const token = signPreviewToken(HELP_CENTER_ID, NOW);
    expect(verifyPreviewToken(HELP_CENTER_ID, token, NOW + 59 * MINUTE)).toBe(true);
    expect(verifyPreviewToken(HELP_CENTER_ID, token, NOW + 61 * MINUTE)).toBe(false);
    expect(verifyPreviewToken(HELP_CENTER_ID, token, NOW + 24 * 60 * MINUTE)).toBe(false);
  });

  it("is refused when the signature is tampered with", () => {
    const token = signPreviewToken(HELP_CENTER_ID, NOW);
    const [expires, signature] = token.split(".");
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(verifyPreviewToken(HELP_CENTER_ID, `${expires}.${flipped}`, NOW)).toBe(false);
    expect(verifyPreviewToken(HELP_CENTER_ID, `${expires}.${signature.slice(0, -1)}`, NOW)).toBe(
      false,
    );
    expect(verifyPreviewToken(HELP_CENTER_ID, `${expires}.${signature}x`, NOW)).toBe(false);
    expect(verifyPreviewToken(HELP_CENTER_ID, `${expires}.`, NOW)).toBe(false);
  });

  it("is refused when the expiry is pushed back", () => {
    const token = signPreviewToken(HELP_CENTER_ID, NOW);
    const [expires, signature] = token.split(".");
    const later = Number(expires) + 3600;
    expect(verifyPreviewToken(HELP_CENTER_ID, `${later}.${signature}`, NOW)).toBe(false);
    // Also once the real token has run out, which is when someone would try.
    expect(verifyPreviewToken(HELP_CENTER_ID, `${later}.${signature}`, NOW + 61 * MINUTE)).toBe(
      false,
    );
    expect(verifyPreviewToken(HELP_CENTER_ID, `abc.${signature}`, NOW)).toBe(false);
    expect(verifyPreviewToken(HELP_CENTER_ID, `Infinity.${signature}`, NOW)).toBe(false);
  });

  it("does not accept a signature made for a different expiry or id layout", () => {
    // "<id>.<expires>" is what gets signed: a token for one id must not verify
    // for an id that only shares a prefix.
    const token = signPreviewToken(`${HELP_CENTER_ID}.1`, NOW);
    expect(verifyPreviewToken(HELP_CENTER_ID, token, NOW)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 1234567890],
    ["an object", { token: "x" }],
    ["an array", ["a", "b"]],
    ["an empty string", ""],
    ["a lone dot", "."],
    ["no separator", "1234567890"],
  ])("is refused for %s", (_what, value) => {
    expect(verifyPreviewToken(HELP_CENTER_ID, value, NOW)).toBe(false);
  });

  it("is refused with extra segments", () => {
    const token = signPreviewToken(HELP_CENTER_ID, NOW);
    expect(verifyPreviewToken(HELP_CENTER_ID, `${token}.extra`, NOW)).toBe(false);
    expect(verifyPreviewToken(HELP_CENTER_ID, `${token}.`, NOW)).toBe(false);
    expect(verifyPreviewToken(HELP_CENTER_ID, `x.${token}`, NOW)).toBe(false);
  });
});

describe("help center view helpers", () => {
  it("fills a stored theme with defaults", () => {
    expect(resolveTheme(null)).toEqual({
      accentColor: "#2747d6",
      font: "sans",
      layout: "cards",
      heroTitle: null,
      heroSubtitle: null,
      showPoweredBy: true,
    });
    expect(resolveTheme({ font: "serif", showPoweredBy: false })).toMatchObject({
      accentColor: "#2747d6",
      font: "serif",
      showPoweredBy: false,
    });
  });

  it("describes the DNS records that prove a custom domain", () => {
    const helpCenter = {
      customDomain: "help.acme.test",
      customDomainTarget: "hc-0123456789abcdef0123",
    } as HelpCenter;
    expect(customDomainRecords(helpCenter)).toEqual({
      cname: { name: "help.acme.test", value: "hc-0123456789abcdef0123.help.test" },
      txt: {
        name: "_hay-help-center.help.acme.test",
        value: "hay-help-center=hc-0123456789abcdef0123",
      },
    });
  });
});

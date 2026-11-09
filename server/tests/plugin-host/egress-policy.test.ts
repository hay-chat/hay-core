import { describe, expect, it } from "@jest/globals";
import {
  hostFromConfigValue,
  isAllowed,
  isBlockedAddress,
  parseAllowRule,
  resolveEgressAllow,
} from "../../plugin-host/egress-policy";

describe("egress policy", () => {
  it("refuses internal, reserved and IPv4-mapped addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:8.8.8.8",
      "::ffff:127.0.0.1",
      "not-an-ip",
    ];
    for (const address of blocked)
      expect([address, isBlockedAddress(address)]).toEqual([address, true]);
    for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) {
      expect([address, isBlockedAddress(address)]).toEqual([address, false]);
    }
  });

  it("parses static rules and rejects malformed ones", () => {
    expect(parseAllowRule("API.Example.com")).toEqual({
      host: "api.example.com",
      wildcard: false,
      port: 443,
    });
    expect(parseAllowRule("*.example.com:8443")).toEqual({
      host: "example.com",
      wildcard: true,
      port: 8443,
    });
    for (const bad of [
      "1.2.3.4",
      "localhost",
      "a b.com",
      "example.com:0",
      "example.com:99999",
      "*.",
      "",
    ]) {
      expect([bad, parseAllowRule(bad)]).toEqual([bad, null]);
    }
  });

  it("matches wildcards on subdomains only, and the declared port only", () => {
    const rules = ["*.fbcdn.net", "api.example.com:8443"].map((text) => parseAllowRule(text)!);
    expect(isAllowed(rules, "scontent.xx.fbcdn.net", 443)).toBe(true);
    expect(isAllowed(rules, "fbcdn.net", 443)).toBe(false);
    expect(isAllowed(rules, "evilfbcdn.net", 443)).toBe(false);
    expect(isAllowed(rules, "api.example.com", 443)).toBe(false);
    expect(isAllowed(rules, "api.example.com", 8443)).toBe(true);
  });

  it("derives hosts from config values", () => {
    expect(hostFromConfigValue("https://Chat.Example.com/app")).toEqual({
      host: "chat.example.com",
      port: 443,
    });
    expect(hostFromConfigValue("http://shop.example.com")).toEqual({
      host: "shop.example.com",
      port: 80,
    });
    expect(hostFromConfigValue("shop.example.com:8080")).toEqual({
      host: "shop.example.com",
      port: 8080,
    });
    expect(hostFromConfigValue("acme", ".zendesk.com")).toEqual({
      host: "acme.zendesk.com",
      port: 443,
    });
    expect(hostFromConfigValue("acme.zendesk.com", ".zendesk.com")).toEqual({
      host: "acme.zendesk.com",
      port: 443,
    });
    expect(hostFromConfigValue("acme.evil.com", ".zendesk.com")).toBeNull();
    expect(hostFromConfigValue("http://127.0.0.1:3001")).toBeNull();
    expect(hostFromConfigValue("https://user:pw@shop.example.com")).toBeNull();
    expect(hostFromConfigValue("ftp://shop.example.com")).toBeNull();
    expect(hostFromConfigValue(undefined)).toBeNull();
  });

  it("resolves declared entries against the organization's config", () => {
    const allow = resolveEgressAllow(
      ["api.stripe.com", { fromConfig: "baseUrl" }, { fromConfig: "missing" }],
      { baseUrl: "https://crm.example.com" },
    );
    expect(allow).toEqual(["api.stripe.com:443", "crm.example.com:443"]);
  });
});

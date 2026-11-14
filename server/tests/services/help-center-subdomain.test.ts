/**
 * The rules for the label an organization picks under the help center domain.
 */
import { describe, it, expect } from "@jest/globals";
import {
  normalizeSubdomain,
  subdomainProblem,
  suggestSubdomain,
} from "../../services/help-center/subdomain";

describe("help center subdomain rules", () => {
  describe("normalizeSubdomain", () => {
    it("lowercases and trims", () => {
      expect(normalizeSubdomain("  Acme-Support ")).toBe("acme-support");
      expect(normalizeSubdomain("ACME")).toBe("acme");
    });

    it("makes an uppercase label acceptable", () => {
      expect(subdomainProblem("Acme")).toBe("invalid_characters");
      expect(subdomainProblem(normalizeSubdomain("Acme"))).toBeNull();
    });
  });

  describe("subdomainProblem", () => {
    it.each(["acme", "acme-support", "a1b", "123", "a--b", "a".repeat(63)])(
      "accepts %s",
      (label) => {
        expect(subdomainProblem(label)).toBeNull();
      },
    );

    it.each(["", "a", "ab"])("rejects %p as too short", (label) => {
      expect(subdomainProblem(label)).toBe("too_short");
    });

    it("rejects 64 characters as too long", () => {
      expect(subdomainProblem("a".repeat(64))).toBe("too_long");
    });

    it.each([
      ["a leading hyphen", "-acme"],
      ["a trailing hyphen", "acme-"],
      ["an underscore", "acme_support"],
      ["a dot", "acme.support"],
      ["a space", "acme support"],
      ["surrounding spaces", " acme "],
      ["an accented letter", "café"],
      ["non-latin script", "日本語サポート"],
      ["a cyrillic look-alike", "аcme"],
      ["a slash", "acme/x"],
      ["a newline", "acme\nevil"],
      ["punycode", "xn--caf-dma"],
      ["punycode of any shape", "xn--80ak6aa92e"],
    ])("rejects %s", (_what, label) => {
      expect(subdomainProblem(label)).toBe("invalid_characters");
    });

    it.each(["www", "api", "admin", "app", "dashboard", "mail", "help", "support", "hay", "cname"])(
      "reserves %s",
      (label) => {
        expect(subdomainProblem(label)).toBe("reserved");
      },
    );

    it.each(["hc-", "hc-abc", "hc-0123456789abcdef0123"])(
      "reserves %s, the namespace of custom domain targets",
      (label) => {
        // "hc-" itself ends with a hyphen, so it is refused either way.
        expect(subdomainProblem(label)).not.toBeNull();
        if (label !== "hc-") expect(subdomainProblem(label)).toBe("reserved");
      },
    );

    it("does not reserve labels that merely contain a reserved word", () => {
      expect(subdomainProblem("apiary")).toBeNull();
      expect(subdomainProblem("my-api")).toBeNull();
      expect(subdomainProblem("hcare")).toBeNull();
    });
  });

  describe("suggestSubdomain", () => {
    it("strips accents", () => {
      expect(suggestSubdomain("Café Olé")).toBe("cafe-ole");
    });

    it("collapses punctuation and trims hyphens", () => {
      expect(suggestSubdomain("  Acme & Sons, Inc.  ")).toBe("acme-sons-inc");
      expect(suggestSubdomain("--Acme__Support!!")).toBe("acme-support");
    });

    it("cuts long names to a valid label", () => {
      const suggestion = suggestSubdomain(`${"a".repeat(62)} bcd`);
      expect(suggestion).toBe("a".repeat(62));
      expect(subdomainProblem(suggestion)).toBeNull();
    });

    it.each(["API", "www", "日本語", "ab", "", "!!!", "HC Clinic"])(
      "returns nothing for %p",
      (name) => {
        expect(suggestSubdomain(name)).toBe("");
      },
    );

    it("only ever returns a usable label", () => {
      for (const name of ["Ünïcödé Shop", "xn--evil", "a.b.c", "Support", "Über 9000"]) {
        const suggestion = suggestSubdomain(name);
        if (suggestion !== "") expect(subdomainProblem(suggestion)).toBeNull();
      }
    });
  });
});

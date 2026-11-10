import { describe, expect, it } from "vitest";
import {
  baseSecurityHeaders,
  contentSecurityPolicy,
  inlineScriptBodies,
  scriptHashSource,
} from "../server/utils/security-headers";

function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name, ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("dashboard base headers", () => {
  it("isolates the browsing context while keeping OAuth popups working", () => {
    expect(baseSecurityHeaders(false)["Cross-Origin-Opener-Policy"]).toBe(
      "same-origin-allow-popups",
    );
  });
});

describe("dashboard Content-Security-Policy", () => {
  it("allows the API (https + wss) and PostHog, and nothing else off-origin for scripts", () => {
    const csp = directives(
      contentSecurityPolicy({
        apiBaseUrl: "https://api.hay.example/",
        posthogHost: "https://eu.i.posthog.com",
        useSSL: true,
      }),
    );

    expect(csp["default-src"]).toBe("'self'");
    expect(csp["script-src"]).toBe(
      "'self' https://api.hay.example https://eu-assets.i.posthog.com",
    );
    expect(csp["connect-src"]).toBe(
      "'self' https://api.hay.example wss://api.hay.example https://eu.i.posthog.com https://eu-assets.i.posthog.com",
    );
    expect(csp["frame-ancestors"]).toBe("'none'");
    expect(csp["object-src"]).toBe("'none'");
    expect(csp).toHaveProperty("upgrade-insecure-requests");
  });

  it("falls back to same-origin when no API host or telemetry is configured", () => {
    const csp = directives(contentSecurityPolicy({ apiBaseUrl: "", useSSL: false }));

    expect(csp["script-src"]).toBe("'self'");
    expect(csp["connect-src"]).toBe("'self'");
    expect(csp).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("frames only itself unless a help center domain is set", () => {
    const base = { apiBaseUrl: "https://api.hay.example", useSSL: true };
    expect(directives(contentSecurityPolicy(base))["frame-src"]).toBe("'self'");
    // The Appearance preview frames `<subdomain>.<domain>`; the server accepts a scheme too.
    for (const helpCenterDomain of ["help.hay.example", "https://help.hay.example/"]) {
      expect(directives(contentSecurityPolicy({ ...base, helpCenterDomain }))["frame-src"]).toBe(
        "'self' https://*.help.hay.example",
      );
    }
    expect(
      directives(
        contentSecurityPolicy({ ...base, useSSL: false, helpCenterDomain: "help.localhost:3001" }),
      )["frame-src"],
    ).toBe("'self' http://*.help.localhost:3001");
  });

  it("ignores a help center domain that could inject other sources", () => {
    const csp = contentSecurityPolicy({
      apiBaseUrl: "",
      useSSL: true,
      helpCenterDomain: "evil.example; script-src *",
    });
    expect(directives(csp)["frame-src"]).toBe("'self'");
    expect(csp).not.toContain("evil.example");
  });

  it("allows inline scripts only by hash", () => {
    const html =
      '<script type="module" src="/_nuxt/a.js"></script><script>window.__NUXT__={}</script>';
    const hashes = inlineScriptBodies(html).map(scriptHashSource);

    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
    expect(
      directives(contentSecurityPolicy({ apiBaseUrl: "", useSSL: false }, hashes))["script-src"],
    ).toBe(`'self' ${hashes[0]}`);
  });
});

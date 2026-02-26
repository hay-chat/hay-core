import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { redactString, REDACT_PATHS, REDACT_CENSOR } from "../../lib/logger/redaction";

// Mock config before importing logger
jest.mock("../../config/env", () => ({
  config: {
    logging: { level: "debug", debug: false },
    isProduction: false,
    isDevelopment: true,
    isTest: true,
  },
}));

describe("PII Redaction", () => {
  describe("redactString", () => {
    it("redacts email addresses", () => {
      const input = "User john.doe@example.com logged in";
      expect(redactString(input)).toBe("User [EMAIL_REDACTED] logged in");
    });

    it("redacts multiple email addresses", () => {
      const input = "From alice@example.com to bob@company.org";
      expect(redactString(input)).toBe("From [EMAIL_REDACTED] to [EMAIL_REDACTED]");
    });

    it("redacts US phone numbers", () => {
      const input = "Call 555-123-4567 for support";
      expect(redactString(input)).toBe("Call [PHONE_REDACTED] for support");
    });

    it("redacts US phone numbers with parentheses", () => {
      const input = "Phone: (555) 123-4567";
      expect(redactString(input)).toBe("Phone: [PHONE_REDACTED]");
    });

    it("redacts US phone numbers with +1 prefix", () => {
      const input = "Number: +1-555-123-4567";
      expect(redactString(input)).toBe("Number: [PHONE_REDACTED]");
    });

    it("redacts international phone numbers", () => {
      const input = "Call +44 7911 123456";
      expect(redactString(input)).toBe("Call [PHONE_REDACTED]");
    });

    it("redacts multiple PII types in a single message", () => {
      const input = "User jane@example.com called from +1-555-123-4567";
      const result = redactString(input);
      expect(result).not.toContain("jane@example.com");
      expect(result).not.toContain("555-123-4567");
      expect(result).toContain("[EMAIL_REDACTED]");
      expect(result).toContain("[PHONE_REDACTED]");
    });

    it("does not redact non-PII content", () => {
      const input = "Server started on port 3001 with 4 workers";
      expect(redactString(input)).toBe(input);
    });

    it("handles empty strings", () => {
      expect(redactString("")).toBe("");
    });

    it("preserves URLs without email-like patterns", () => {
      const input = "Visit https://example.com/path for docs";
      expect(redactString(input)).toBe(input);
    });

    it("redacts email in URLs", () => {
      const input = "Callback: https://example.com?email=user@test.com";
      expect(redactString(input)).not.toContain("user@test.com");
    });

    it("redacts JWT tokens", () => {
      const input = "Token: eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.dummysignature12345";
      expect(redactString(input)).toContain("[TOKEN_REDACTED]");
      expect(redactString(input)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    });

    it("redacts Bearer tokens", () => {
      const input = "Authorization: Bearer abc123.def456.ghi789";
      expect(redactString(input)).toContain("Bearer [TOKEN_REDACTED]");
      expect(redactString(input)).not.toContain("abc123.def456.ghi789");
    });
  });

  describe("REDACT_PATHS", () => {
    it("includes common credential fields", () => {
      expect(REDACT_PATHS).toContain("password");
      expect(REDACT_PATHS).toContain("token");
      expect(REDACT_PATHS).toContain("apiKey");
      expect(REDACT_PATHS).toContain("secret");
      expect(REDACT_PATHS).toContain("accessToken");
      expect(REDACT_PATHS).toContain("refreshToken");
    });

    it("includes personal data fields", () => {
      expect(REDACT_PATHS).toContain("email");
      expect(REDACT_PATHS).toContain("phone");
      expect(REDACT_PATHS).toContain("ssn");
      expect(REDACT_PATHS).toContain("creditCard");
    });

    it("includes authorization headers", () => {
      expect(REDACT_PATHS).toContain("headers.authorization");
      expect(REDACT_PATHS).toContain("headers.Authorization");
    });

    it("includes nested wildcard paths at multiple depths", () => {
      expect(REDACT_PATHS).toContain("*.email");
      expect(REDACT_PATHS).toContain("*.password");
      expect(REDACT_PATHS).toContain("*.token");
      // Depth 2 paths
      expect(REDACT_PATHS).toContain("*.*.email");
      expect(REDACT_PATHS).toContain("*.*.password");
      expect(REDACT_PATHS).toContain("*.*.token");
      expect(REDACT_PATHS).toContain("*.*.secret");
    });

    it("includes IP address fields", () => {
      expect(REDACT_PATHS).toContain("ipAddress");
      expect(REDACT_PATHS).toContain("ip_address");
      expect(REDACT_PATHS).toContain("ip");
      expect(REDACT_PATHS).toContain("*.ip");
    });

    it("includes nested header paths", () => {
      expect(REDACT_PATHS).toContain("*.headers.authorization");
      expect(REDACT_PATHS).toContain("*.headers.cookie");
    });
  });

  describe("REDACT_CENSOR", () => {
    it("uses [REDACTED] as the censor string", () => {
      expect(REDACT_CENSOR).toBe("[REDACTED]");
    });
  });
});

describe("Logger", () => {
  it("creates child logger with module context", async () => {
    const { createLogger } = await import("../../lib/logger");
    const childLogger = createLogger("test-module");
    expect(childLogger).toBeDefined();
    expect(typeof childLogger.info).toBe("function");
    expect(typeof childLogger.error).toBe("function");
    expect(typeof childLogger.warn).toBe("function");
    expect(typeof childLogger.debug).toBe("function");
  });

  it("exposes root logger instance", async () => {
    const { logger } = await import("../../lib/logger");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });
});

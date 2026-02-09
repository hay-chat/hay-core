/**
 * Tests for JWT secret validation at startup.
 *
 * Verifies that the server refuses to start with:
 * - Missing JWT secrets
 * - Secrets shorter than 32 characters
 * - Known insecure default values
 */

// Helper to load env.ts module with controlled environment variables.
// Uses jest.resetModules() + require() so each call gets a fresh config.
function loadConfigWith(envOverrides) {
  jest.resetModules();

  const originalEnv = { ...process.env };
  Object.assign(process.env, envOverrides);

  // Use relative path since @server/ path alias isn't configured in Jest
  const envModule = require("../../config/env");

  process.env = originalEnv;
  return envModule;
}

const VALID_SECRET = "a".repeat(32);
const VALID_REFRESH_SECRET = "b".repeat(32);

describe("JWT Secret Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("validateJwtSecrets()", () => {
    it("should pass when both secrets are valid (>= 32 chars)", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: VALID_SECRET,
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).not.toThrow();
    });

    it("should skip validation in test environment", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "test",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: "",
      });

      expect(() => validateJwtSecrets()).not.toThrow();
    });

    it("should fail when JWT_SECRET is missing", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).toThrow("JWT_SECRET is required but not set");
    });

    it("should fail when JWT_REFRESH_SECRET is missing", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: VALID_SECRET,
        JWT_REFRESH_SECRET: "",
      });

      expect(() => validateJwtSecrets()).toThrow("JWT_REFRESH_SECRET is required but not set");
    });

    it("should fail when both secrets are missing", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: "",
      });

      expect(() => validateJwtSecrets()).toThrow("JWT secret validation failed");
    });

    it("should fail when JWT_SECRET is too short (< 32 chars)", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "short-secret",
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).toThrow("JWT_SECRET must be at least 32 characters");
    });

    it("should fail when JWT_REFRESH_SECRET is too short (< 32 chars)", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: VALID_SECRET,
        JWT_REFRESH_SECRET: "short",
      });

      expect(() => validateJwtSecrets()).toThrow(
        "JWT_REFRESH_SECRET must be at least 32 characters",
      );
    });

    it("should reject known insecure default: 'default-secret-change-in-production'", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "default-secret-change-in-production",
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).toThrow("insecure default value");
    });

    it("should reject known insecure default: 'your-secret-key-change-in-production'", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "your-secret-key-change-in-production",
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).toThrow("insecure default value");
    });

    it("should reject known insecure default for refresh secret", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: VALID_SECRET,
        JWT_REFRESH_SECRET: "default-refresh-secret-change-in-production",
      });

      expect(() => validateJwtSecrets()).toThrow("insecure default value");
    });

    it("should reject 'secret' as a known insecure default", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "secret",
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).toThrow("insecure default value");
    });

    it("should reject 'changeme' as a known insecure default", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "changeme",
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateJwtSecrets()).toThrow("insecure default value");
    });

    it("should accept exactly 32-character secrets", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "x".repeat(32),
        JWT_REFRESH_SECRET: "y".repeat(32),
      });

      expect(() => validateJwtSecrets()).not.toThrow();
    });

    it("should accept long secrets (128 chars hex)", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "a".repeat(128),
        JWT_REFRESH_SECRET: "b".repeat(128),
      });

      expect(() => validateJwtSecrets()).not.toThrow();
    });

    it("should include generation instructions in error message", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: "",
      });

      try {
        validateJwtSecrets();
        fail("Should have thrown");
      } catch (e) {
        expect(e.message).toContain("crypto");
        expect(e.message).toContain("randomBytes");
      }
    });

    it("should enforce validation in development environment", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: "",
      });

      expect(() => validateJwtSecrets()).toThrow();
    });

    it("should enforce validation in production environment", () => {
      const { validateJwtSecrets } = loadConfigWith({
        NODE_ENV: "production",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: "",
      });

      expect(() => validateJwtSecrets()).toThrow();
    });
  });

  describe("validateProductionConfig()", () => {
    it("should call JWT validation before production checks", () => {
      const { validateProductionConfig } = loadConfigWith({
        NODE_ENV: "production",
        JWT_SECRET: "",
        JWT_REFRESH_SECRET: "",
      });

      expect(() => validateProductionConfig()).toThrow("JWT secret validation failed");
    });

    it("should pass in development with valid JWT secrets", () => {
      const { validateProductionConfig } = loadConfigWith({
        NODE_ENV: "development",
        JWT_SECRET: VALID_SECRET,
        JWT_REFRESH_SECRET: VALID_REFRESH_SECRET,
      });

      expect(() => validateProductionConfig()).not.toThrow();
    });
  });

  describe("config.jwt has no default secrets", () => {
    it("should have empty string when JWT_SECRET env var is not set", () => {
      const { config } = loadConfigWith({
        NODE_ENV: "test",
        JWT_SECRET: undefined,
        JWT_REFRESH_SECRET: undefined,
      });

      expect(config.jwt.secret).toBe("");
      expect(config.jwt.refreshSecret).toBe("");
    });
  });
});

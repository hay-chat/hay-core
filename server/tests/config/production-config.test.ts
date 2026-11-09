import { describe, it, expect, afterEach, jest } from "@jest/globals";

/**
 * validateProductionConfig: a production server refuses to start with
 * missing or default secrets and reports weaker settings as warnings.
 */

const VALID_ENV = {
  NODE_ENV: "production",
  JWT_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  API_DOMAIN: "api.example.com",
  DASHBOARD_DOMAIN: "app.example.com",
  OPENAI_API_KEY: "sk-test",
  DB_PASSWORD: "a-strong-db-password",
  RABBITMQ_URL: "amqp://hay:a-strong-mq-password@mq:5672/",
  PLUGIN_ENCRYPTION_KEY: "c".repeat(32),
  LOG_LEVEL: "info",
  DB_HOST: "localhost",
  REDIS_HOST: "localhost",
  TRUST_PROXY: "1",
};

const originalEnv = { ...process.env };

function load(overrides: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...VALID_ENV } as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../config/env") as typeof import("../../config/env");
}

describe("validateProductionConfig", () => {
  afterEach(() => {
    process.env = originalEnv;
  });

  it("accepts a complete production configuration without warnings", () => {
    expect(load({}).validateProductionConfig()).toEqual([]);
  });

  it.each([
    ["DB_PASSWORD unset", { DB_PASSWORD: undefined }, "DB_PASSWORD"],
    ["the default DB password", { DB_PASSWORD: "hay_password" }, "DB_PASSWORD"],
    ["RABBITMQ_URL unset", { RABBITMQ_URL: undefined }, "RABBITMQ_URL"],
    [
      "default RabbitMQ credentials",
      { RABBITMQ_URL: "amqp://hay:hay_password@mq:5672/" },
      "RABBITMQ_URL",
    ],
    ["PLUGIN_ENCRYPTION_KEY unset", { PLUGIN_ENCRYPTION_KEY: undefined }, "PLUGIN_ENCRYPTION_KEY"],
    ["a short PLUGIN_ENCRYPTION_KEY", { PLUGIN_ENCRYPTION_KEY: "short" }, "PLUGIN_ENCRYPTION_KEY"],
    ["a short INTERNAL_API_SECRET", { INTERNAL_API_SECRET: "short" }, "INTERNAL_API_SECRET"],
  ])("refuses to start with %s", (_label, overrides, variable) => {
    expect(() => load(overrides).validateProductionConfig()).toThrow(variable);
  });

  it("warns when the proxy hop count is left to its default", () => {
    expect(load({ TRUST_PROXY: undefined }).validateProductionConfig().join("\n")).toMatch(
      /TRUST_PROXY/,
    );
  });

  it("warns about debug logging and unverified TLS on a private network", () => {
    const warnings = load({
      LOG_LEVEL: "debug",
      DB_HOST: "postgres",
      DB_SSL: "true",
      REDIS_HOST: "redis",
    }).validateProductionConfig();
    expect(warnings.join("\n")).toMatch(/LOG_LEVEL=debug/);
    expect(warnings.join("\n")).toMatch(/DB_SSL_CA/);
  });

  it.each([
    ["no TLS to a remote database", { DB_HOST: "db.example.com" }, "DB_SSL"],
    ["no CA for a remote database", { DB_HOST: "db.example.com", DB_SSL: "true" }, "DB_SSL_CA"],
    ["no password for a remote Redis", { REDIS_HOST: "redis.example.com" }, "REDIS_PASSWORD"],
  ])("refuses to start with %s", (_label, overrides, variable) => {
    expect(() => load(overrides).validateProductionConfig()).toThrow(variable);
  });

  it("accepts a remote database with TLS and a CA", () => {
    expect(
      load({
        DB_HOST: "db.example.com",
        DB_SSL: "true",
        DB_SSL_CA: "-----BEGIN CERTIFICATE-----",
      }).validateProductionConfig(),
    ).toEqual([]);
  });

  it("refuses to start when NODE_ENV is unset", () => {
    expect(() => load({ NODE_ENV: undefined }).validateProductionConfig()).toThrow("NODE_ENV");
  });

  it("treats loopback, private and container hosts as not remote", () => {
    const { isRemoteHost } = load({});
    expect(
      ["localhost", "10.0.0.5", "172.20.0.2", "192.168.1.9", "postgres"].some(isRemoteHost),
    ).toBe(false);
    expect(isRemoteHost("db-do-user.b.db.ondigitalocean.com")).toBe(true);
  });

  it("skips the production checks in development", () => {
    expect(
      load({ NODE_ENV: "development", DB_PASSWORD: undefined }).validateProductionConfig(),
    ).toEqual([]);
  });

  it("defaults the log level to info", () => {
    expect(load({ LOG_LEVEL: undefined }).config.logging.level).toBe("info");
  });
});

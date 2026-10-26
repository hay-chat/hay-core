/**
 * A plugin manifest may ask for host env vars by name, but the runner refuses
 * anything that looks like a secret. Public identity values such as the
 * platform From address are the one exception, even though their names start
 * with SMTP.
 */
import { isDeniedPluginEnv } from "@server/lib/plugin-env";

describe("isDeniedPluginEnv", () => {
  it("blocks secrets and infrastructure settings by pattern", () => {
    for (const name of [
      "RESEND_WEBHOOK_SECRET",
      "SMTP_AUTH_PASS",
      "SMTP_HOST",
      "DB_PASSWORD",
      "OPENAI_API_KEY",
      "JWT_SECRET",
      "HAY_INTERNAL_API_SECRET",
      "GITHUB_TOKEN",
      "VAPID_PRIVATE_KEY",
    ]) {
      expect(isDeniedPluginEnv(name)).toBe(true);
    }
  });

  it("allows ordinary host settings", () => {
    for (const name of [
      "RESEND_API_KEY",
      "EMAIL_INBOUND_DOMAIN",
      "API_DOMAIN",
      "VAPID_PUBLIC_KEY",
    ]) {
      expect(isDeniedPluginEnv(name)).toBe(false);
    }
  });

  it("allows the public From address and name despite the SMTP prefix", () => {
    expect(isDeniedPluginEnv("SMTP_FROM_EMAIL")).toBe(false);
    expect(isDeniedPluginEnv("SMTP_FROM_NAME")).toBe(false);
  });
});

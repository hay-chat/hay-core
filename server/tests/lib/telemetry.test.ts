/**
 * Telemetry must be entirely optional: with no POSTHOG_KEY the server should
 * never construct a PostHog client, never make an outbound request, and never
 * turn a handled error into a second failure.
 */
describe("Server telemetry", () => {
  const originalKey = process.env["POSTHOG_KEY"];

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env["POSTHOG_KEY"];
    } else {
      process.env["POSTHOG_KEY"] = originalKey;
    }
    jest.resetModules();
  });

  const loadTelemetry = async (key?: string) => {
    if (key === undefined) {
      delete process.env["POSTHOG_KEY"];
    } else {
      process.env["POSTHOG_KEY"] = key;
    }
    jest.resetModules();
    return import("@server/lib/telemetry");
  };

  describe("without POSTHOG_KEY", () => {
    it("stays disabled after init", async () => {
      const telemetry = await loadTelemetry();

      telemetry.initTelemetry();

      expect(telemetry.isTelemetryEnabled()).toBe(false);
    });

    it("swallows captures instead of throwing", async () => {
      const telemetry = await loadTelemetry();
      telemetry.initTelemetry();

      expect(() => telemetry.captureException(new Error("boom"))).not.toThrow();
      expect(() =>
        telemetry.captureException(new Error("boom"), {
          userId: "user-1",
          organizationId: "org-1",
        }),
      ).not.toThrow();
    });

    it("shuts down cleanly when it was never enabled", async () => {
      const telemetry = await loadTelemetry();

      await expect(telemetry.shutdownTelemetry()).resolves.toBeUndefined();
    });

    it("is a no-op even when init was never called", async () => {
      const telemetry = await loadTelemetry();

      expect(telemetry.isTelemetryEnabled()).toBe(false);
      expect(() => telemetry.captureException(new Error("boom"))).not.toThrow();
    });
  });

  describe("with POSTHOG_KEY", () => {
    it("enables after init and disables again after shutdown", async () => {
      const telemetry = await loadTelemetry("phc_test_key");

      telemetry.initTelemetry();
      expect(telemetry.isTelemetryEnabled()).toBe(true);

      await telemetry.shutdownTelemetry();
      expect(telemetry.isTelemetryEnabled()).toBe(false);
    });
  });
});

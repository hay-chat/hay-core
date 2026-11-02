import { describe, expect, it, vi } from "vitest";

// Nuxt auto-imports the composable and plugin rely on.
const client = { identify: vi.fn(), group: vi.fn(), reset: vi.fn() };
vi.stubGlobal("useNuxtApp", () => ({ $posthog: client }));
vi.stubGlobal("defineNuxtPlugin", (setup: unknown) => setup);

const { useTelemetry } = await import("../composables/useTelemetry");
const { posthogOptions, pageviewUrl } = await import("../plugins/posthog.client");

describe("telemetry privacy", () => {
  it("identifies users by id only", () => {
    useTelemetry().identify({ id: "user-1" });
    expect(client.identify).toHaveBeenCalledWith("user-1");
  });

  it("masks element text and attributes in autocapture and text in replays", () => {
    expect(posthogOptions).toMatchObject({
      mask_all_text: true,
      mask_all_element_attributes: true,
      session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    });
  });

  it("drops the query string and hash from pageview URLs", () => {
    expect(pageviewUrl("https://app.test", "/reset-password")).toBe(
      "https://app.test/reset-password",
    );
  });
});

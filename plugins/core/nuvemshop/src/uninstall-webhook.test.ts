import { describe, expect, it, vi } from "vitest";
import { ensureUninstallWebhook, uninstallWebhookUrl } from "./uninstall-webhook.js";

const URL_ = "https://api.hay.example/v1/plugins/hay-plugin-nuvemshop/webhook";

describe("uninstallWebhookUrl", () => {
  it("builds the plugin webhook URL from the server's public URL", () => {
    expect(uninstallWebhookUrl("https://api.hay.example/", "hay-plugin-nuvemshop")).toBe(URL_);
  });

  it("returns null when Nuvemshop would refuse the URL", () => {
    expect(uninstallWebhookUrl(undefined, "p")).toBeNull();
    expect(uninstallWebhookUrl("http://api.hay.example", "p")).toBeNull();
    expect(uninstallWebhookUrl("https://localhost:3001", "p")).toBeNull();
    expect(uninstallWebhookUrl("not a url", "p")).toBeNull();
  });
});

describe("ensureUninstallWebhook", () => {
  it("creates the webhook with the documented body when the store has none", async () => {
    const api = {
      get: vi.fn(async () => [{ id: 1, event: "order/created", url: URL_ }]),
      post: vi.fn(async () => ({})),
    };
    await expect(ensureUninstallWebhook(api as never, URL_)).resolves.toBe(true);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/webhooks", { event: "app/uninstalled", url: URL_ });
  });

  it("does not create a second one on reconnect", async () => {
    const api = {
      get: vi.fn(async () => [{ id: 2, event: "app/uninstalled", url: URL_ }]),
      post: vi.fn(async () => ({})),
    };
    await expect(ensureUninstallWebhook(api as never, URL_)).resolves.toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  });
});

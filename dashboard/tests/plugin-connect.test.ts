import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConnectEvent,
  completeConnectSteps,
  failConnectSteps,
  initialConnectSteps,
  PLUGIN_INSTALL_PROGRESS_EVENT,
} from "../utils/plugin-connect-steps";

const enablePlugin = vi.fn();
vi.mock("@/stores/app", () => ({ useAppStore: () => ({ enablePlugin }) }));

const handlers = new Map<string, (payload: unknown) => void>();
vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    on: (type: string, handler: (payload: unknown) => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  }),
}));

const { usePluginConnect } = await import("../composables/usePluginConnect");

const statuses = (steps: { key: string; status: string }[]) =>
  steps.map((s) => `${s.key}:${s.status}`);

describe("plugin connect steps", () => {
  it("fills in what the socket missed once the request succeeds", () => {
    let steps = applyConnectEvent(initialConnectSteps(), "install", "skipped", 1);
    steps = applyConnectEvent(steps, "build", "active", 2);
    expect(statuses(completeConnectSteps(steps, 3))).toEqual([
      "install:skipped",
      "build:done",
      "enable:done",
      "start:done",
    ]);
  });

  it("marks the running step failed, or keeps the one the server marked", () => {
    const running = applyConnectEvent(initialConnectSteps(), "build", "active", 1);
    expect(statuses(failConnectSteps(running, 2))[1]).toBe("build:failed");

    const serverFailed = applyConnectEvent(running, "build", "failed", 2);
    expect(failConnectSteps(serverFailed, 3)).toBe(serverFailed);
  });
});

describe("usePluginConnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    enablePlugin.mockReset();
    handlers.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("never opens the dialog for a quick connect", async () => {
    enablePlugin.mockResolvedValue({ success: true });
    const connect = usePluginConnect();
    await expect(connect.connect({ pluginId: "shopify", pluginName: "Shopify" })).resolves.toBe(
      true,
    );
    expect(connect.open.value).toBe(false);
  });

  it("shows live steps when slow, then continues after the countdown", async () => {
    let finishRequest!: () => void;
    enablePlugin.mockImplementation(
      () => new Promise<void>((resolve) => (finishRequest = resolve)),
    );
    const connect = usePluginConnect();
    const result = connect.connect({ pluginId: "shopify", pluginName: "Shopify" });

    await vi.advanceTimersByTimeAsync(800);
    expect(connect.open.value).toBe(true);

    const progressId = enablePlugin.mock.calls[0][2] as string;
    const emit = handlers.get(PLUGIN_INSTALL_PROGRESS_EVENT)!;
    emit({ progressId: "someone-else", pluginId: "shopify", step: "install", status: "active" });
    emit({ progressId, pluginId: "shopify", step: "build", status: "active" });
    expect(statuses(connect.steps.value).slice(0, 2)).toEqual(["install:pending", "build:active"]);

    finishRequest();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.phase.value).toBe("done");

    // Hovering the dialog holds the countdown.
    connect.setCountdownPaused(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(connect.open.value).toBe(true);
    connect.setCountdownPaused(false);

    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe(true);
    expect(connect.open.value).toBe(false);
  });

  it("keeps a slow failure in the dialog and can try again", async () => {
    let failRequest!: (error: Error) => void;
    enablePlugin.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (failRequest = reject)),
    );
    const connect = usePluginConnect();
    const result = connect.connect({ pluginId: "shopify", pluginName: "Shopify" });

    await vi.advanceTimersByTimeAsync(800);
    failRequest(new Error("Failed to enable Shopify: tsc exited with code 2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.phase.value).toBe("failed");
    expect(connect.errorMessage.value).toContain("tsc exited");

    enablePlugin.mockResolvedValueOnce({ success: true });
    connect.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.phase.value).toBe("done");
    connect.continueNow();
    await expect(result).resolves.toBe(true);
  });

  it("leaves a quick failure to the caller", async () => {
    enablePlugin.mockRejectedValue(new Error("nope"));
    const connect = usePluginConnect();
    await expect(connect.connect({ pluginId: "shopify", pluginName: "Shopify" })).rejects.toThrow(
      "nope",
    );
    expect(connect.open.value).toBe(false);
  });
});

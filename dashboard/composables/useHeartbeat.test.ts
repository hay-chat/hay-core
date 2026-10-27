import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const heartbeat = vi.fn().mockResolvedValue(undefined);
vi.mock("@/utils/api", () => ({ Hay: { auth: { heartbeat: { mutate: heartbeat } } } }));

// The composable registers lifecycle hooks; the tests drive start/stop directly.
// Only reactivity is needed (runtime-dom would touch the fake document on load).
vi.mock("vue", async () => ({
  ref: (await import("@vue/reactivity")).ref,
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
}));

/** Minimal document: an EventTarget with a settable `hidden`. */
class FakeDocument extends EventTarget {
  hidden = false;
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

const INTERVAL = 30_000;

describe("useHeartbeat", () => {
  let doc: FakeDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    heartbeat.mockClear();
    doc = new FakeDocument();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("useRoute", () => ({ meta: {} }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function start() {
    const { useHeartbeat } = await import("./useHeartbeat");
    const api = useHeartbeat();
    api.startHeartbeat();
    return api;
  }

  it("sends a heartbeat immediately and then every 30 s", async () => {
    await start();
    expect(heartbeat).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL * 2);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and resumes after hide → show, repeatedly", async () => {
    const { isActive } = await start();
    expect(heartbeat).toHaveBeenCalledTimes(1);

    for (let cycle = 0; cycle < 3; cycle++) {
      doc.setHidden(true);
      const callsWhenHidden = heartbeat.mock.calls.length;
      vi.advanceTimersByTime(INTERVAL * 3);
      expect(heartbeat).toHaveBeenCalledTimes(callsWhenHidden);
      expect(isActive.value).toBe(true);

      doc.setHidden(false);
      // An immediate beat on show, then the interval keeps going.
      expect(heartbeat).toHaveBeenCalledTimes(callsWhenHidden + 1);
      vi.advanceTimersByTime(INTERVAL);
      expect(heartbeat).toHaveBeenCalledTimes(callsWhenHidden + 2);
    }
  });

  it("does not beat while the tab starts hidden, and starts on show", async () => {
    doc.hidden = true;
    await start();
    vi.advanceTimersByTime(INTERVAL * 2);
    expect(heartbeat).not.toHaveBeenCalled();

    doc.setHidden(false);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("stays stopped after stopHeartbeat even when the tab is shown again", async () => {
    const { stopHeartbeat, isActive } = await start();
    stopHeartbeat();
    expect(isActive.value).toBe(false);

    doc.setHidden(true);
    doc.setHidden(false);
    vi.advanceTimersByTime(INTERVAL * 2);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("does not double the interval when started twice or shown twice", async () => {
    const { startHeartbeat } = await start();
    startHeartbeat();
    doc.setHidden(false);
    doc.setHidden(false);
    vi.advanceTimersByTime(INTERVAL);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("skips public pages", async () => {
    vi.stubGlobal("useRoute", () => ({ meta: { public: true } }));
    const { isActive } = await start();
    expect(isActive.value).toBe(false);
    expect(heartbeat).not.toHaveBeenCalled();
  });
});

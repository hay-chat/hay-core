import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  startActivity,
  endActivity,
  highlight,
  resetActivity,
  ACTIVITY_ROOT_ID,
} from "../agentActivity";

/** The orange "AI is acting on this page" overlay shown while a page tool runs. */
describe("agentActivity", () => {
  const root = () => document.getElementById(ACTIVITY_ROOT_ID);

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<button id="connect">Connect Shopify</button>`;
  });

  afterEach(() => {
    resetActivity();
    vi.useRealTimers();
  });

  it("adds nothing to the page until the first activity", () => {
    expect(root()).toBeNull();
    startActivity("Hay", "Open integrations");
    expect(root()?.hasAttribute("data-on")).toBe(true);
    expect(root()?.querySelector(".hay-agent-pill")?.textContent).toBe("Hay · Open integrations");
  });

  it("boxes the target element with a label and lingers after the tool ends", () => {
    startActivity("Hay", "Connect Shopify");
    expect(highlight("#connect", "Click here")).toBe(true);
    const box = root()?.querySelector(".hay-agent-box");
    expect(box?.hasAttribute("data-on")).toBe(true);
    expect(box?.querySelector(".hay-agent-label")?.textContent).toBe("Click here");

    endActivity();
    expect(root()?.hasAttribute("data-on")).toBe(true); // still visible
    vi.advanceTimersByTime(1300);
    expect(root()?.hasAttribute("data-on")).toBe(false);
    expect(box?.hasAttribute("data-on")).toBe(false);
  });

  it("returns false for a missing or invalid selector", () => {
    expect(highlight("#nope")).toBe(false);
    expect(highlight("<<<")).toBe(false);
    expect(highlight(null)).toBe(false);
  });

  it("shows a standalone highlight that fades by itself", () => {
    expect(highlight(document.getElementById("connect"))).toBe(true);
    expect(root()?.hasAttribute("data-on")).toBe(true);
    vi.advanceTimersByTime(2600);
    expect(root()?.hasAttribute("data-on")).toBe(false);
  });
});

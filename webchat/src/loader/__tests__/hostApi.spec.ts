import { describe, it, expect, beforeEach, vi } from "vitest";
import { installHostApi } from "../hostApi";

/**
 * widget.js records host calls until the chat chunk loads, and gives pages
 * written for WebMCP (`navigator.modelContext`) a way in with no Hay code.
 */
describe("host API before the chat loads", () => {
  beforeEach(() => {
    delete window.HayChat;
    delete (navigator as { modelContext?: unknown }).modelContext;
  });

  it("queues registerTool / unregisterTool for replay", () => {
    const calls = installHostApi();
    const tool = { name: "open_cart", description: "Open the cart", execute: () => null };
    window.HayChat!.registerTool!(tool);
    window.HayChat!.unregisterTool!("open_cart");
    expect(calls).toEqual([
      { name: "registerTool", args: [tool] },
      { name: "unregisterTool", args: ["open_cart"] },
    ]);
    expect(window.HayChat!.highlight!("#x")).toBe(false);
  });

  it("registers tools pushed to window.HayChat.tools before and after it ran", () => {
    const early = { name: "early", description: "x", execute: () => null };
    const late = { name: "late", description: "x", execute: () => null };
    window.HayChat = { tools: [early] };
    const calls = installHostApi();
    (window.HayChat.tools as { push: (t: typeof late) => void }).push(late);
    expect(calls).toEqual([
      { name: "registerTool", args: [early] },
      { name: "registerTool", args: [late] },
    ]);
  });

  it("provides navigator.modelContext when the browser has none", () => {
    const calls = installHostApi();
    const tool = { name: "a", description: "x", execute: () => null };
    navigator.modelContext!.registerTool(tool);
    navigator.modelContext!.provideContext({ tools: [tool] });
    navigator.modelContext!.clearContext();
    expect(calls.map((c) => c.name)).toEqual(["registerTool", "provideContext", "provideContext"]);
    expect(calls[2]).toEqual({ name: "provideContext", args: [{ tools: [] }] });
  });

  it("follows window.HayChat once the chat took the functions over", () => {
    installHostApi();
    const live = vi.fn();
    window.HayChat!.registerTool = live;
    const tool = { name: "a", description: "x", execute: () => null };
    navigator.modelContext!.registerTool(tool);
    expect(live).toHaveBeenCalledWith(tool);
  });

  it("tees into a native modelContext without replacing it", () => {
    const registerTool = vi.fn();
    const unregisterTool = vi.fn();
    const native = { registerTool, unregisterTool };
    (navigator as { modelContext?: unknown }).modelContext = native;
    const calls = installHostApi();
    expect(navigator.modelContext).toBe(native);
    const tool = { name: "a", description: "x", execute: () => null };
    navigator.modelContext!.registerTool(tool);
    navigator.modelContext!.unregisterTool("a");
    expect(registerTool).toHaveBeenCalledWith(tool);
    expect(unregisterTool).toHaveBeenCalledWith("a");
    expect(calls.map((c) => c.name)).toEqual(["registerTool", "unregisterTool"]);
  });
});

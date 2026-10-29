import type { HostCall, ModelContext, PageTool } from "@/types";

/**
 * window.HayChat.addContext / grantConsent / revokeConsent / registerTool work
 * from the moment widget.js runs. Until the chat chunk loads, calls are recorded
 * and replayed in order when it mounts; the chunk then takes the functions over.
 */
export function installHostApi(): HostCall[] {
  const calls: HostCall[] = [];
  const hayChat = (window.HayChat ??= {});
  hayChat.addContext = (key, value) => {
    calls.push({ name: "addContext", args: [key, value] });
  };
  hayChat.grantConsent = () => {
    calls.push({ name: "grantConsent", args: [] });
  };
  hayChat.revokeConsent = () => {
    calls.push({ name: "revokeConsent", args: [] });
    // Withdrawal must not wait for a chunk that may never load ("interaction"
    // mode): wipe what an earlier visit stored right away.
    wipePersistentStorage();
  };
  hayChat.registerTool = (tool) => {
    calls.push({ name: "registerTool", args: [tool] });
  };
  hayChat.unregisterTool = (name) => {
    calls.push({ name: "unregisterTool", args: [name] });
  };
  // Nothing to point at before the chat is on the page.
  hayChat.highlight = () => false;
  // widget.js is loaded async, so page code may run first: tools it put in
  // window.HayChat.tools are registered now, and later pushes go straight in.
  const early = Array.isArray(hayChat.tools) ? hayChat.tools : [];
  early.forEach((tool) => hayChat.registerTool?.(tool));
  hayChat.tools = {
    push: (...tools: PageTool[]) => tools.forEach((t) => hayChat.registerTool?.(t)),
  };
  installModelContext(calls);
  return calls;
}

/**
 * WebMCP: a page written for `navigator.modelContext` needs no Hay-specific
 * code. Without browser support the widget provides the object; with it, the
 * page's registrations are copied to Hay as well, so the same tools serve the
 * browser's agent and the Hay agent. Every call goes through window.HayChat,
 * which the chat chunk replaces once loaded.
 */
function installModelContext(calls: HostCall[]): void {
  const hay = () => window.HayChat ?? {};
  const native = navigator.modelContext;
  if (!native) {
    const shim: ModelContext = {
      registerTool: (tool) => hay().registerTool?.(tool),
      unregisterTool: (name) => hay().unregisterTool?.(name),
      provideContext: (context) => {
        calls.push({ name: "provideContext", args: [context] });
      },
      clearContext: () => {
        calls.push({ name: "provideContext", args: [{ tools: [] }] });
      },
    };
    navigator.modelContext = shim;
    return;
  }
  const register = native.registerTool.bind(native);
  const unregister = native.unregisterTool.bind(native);
  native.registerTool = (tool: PageTool) => {
    hay().registerTool?.(tool);
    return register(tool);
  };
  native.unregisterTool = (name: string) => {
    hay().unregisterTool?.(name);
    return unregister(name);
  };
}

function wipePersistentStorage(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("hay-")) localStorage.removeItem(key);
    }
    indexedDB.deleteDatabase("hay-dpop-keys");
  } catch {
    // Storage blocked: there is nothing of ours in it.
  }
}

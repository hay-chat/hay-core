import type { HostCall } from "@/types";

/**
 * window.HayChat.addContext / grantConsent / revokeConsent work from the
 * moment widget.js runs. Until the chat chunk loads, calls are recorded and
 * replayed in order when it mounts; the chunk then takes the functions over.
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
  return calls;
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

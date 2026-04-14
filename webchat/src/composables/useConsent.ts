/**
 * ePrivacy consent gate for the webchat widget.
 *
 * ePrivacy Article 5(3) (as interpreted by EDPB Guidelines 2/2023) covers all
 * terminal storage — cookies, sessionStorage, localStorage, IndexedDB — and
 * requires prior consent unless storage is strictly necessary for a service
 * the user has explicitly requested.
 *
 * Model:
 *   - Before the visitor has interacted with the widget: no device storage.
 *   - After the visitor sends their first message (explicit service request):
 *     sessionStorage is exempt as strictly-necessary chat state.
 *   - localStorage / IndexedDB are persistent across sessions and need a
 *     stronger signal:
 *       - `implicit` mode (default): enabled automatically once the user
 *         has interacted, unless the host site calls `revokeConsent()`.
 *       - `strict` mode: only enabled after the host calls `grantConsent()`.
 *   - `grantConsent()` before any interaction unlocks both tiers immediately,
 *     so returning visitors can resume prior conversations on mount.
 *   - `revokeConsent()` wipes every `hay-*` key from localStorage and clears
 *     the DPoP IndexedDB object store. The live in-tab chat keeps working
 *     via sessionStorage.
 */

import { computed, ref } from "vue";
import { clearAllKeypairs } from "./useDPoP";

export type ConsentMode = "strict" | "implicit";

// Module-level singleton: consent state must be shared across every composable
// in the widget. Composables that need reactivity read from these refs via
// useConsent() or the safeStorage wrappers below.
const mode = ref<ConsentMode>("implicit");
const hasInteracted = ref(false);
// null = neither grant nor revoke has been called yet
const explicitGrant = ref<boolean | null>(null);

const canUseSession = computed(() => hasInteracted.value || explicitGrant.value === true);

const canUseLocal = computed(() => {
  if (!canUseSession.value) return false;
  if (mode.value === "strict") return explicitGrant.value === true;
  // implicit: allow unless explicitly revoked
  return explicitGrant.value !== false;
});

/**
 * Initialize consent mode from the widget config. Called once from main.ts
 * before any composable touches storage. Safe to call again to reset state
 * in tests.
 */
export function initConsent(configMode: ConsentMode = "implicit"): void {
  mode.value = configMode;
  hasInteracted.value = false;
  explicitGrant.value = null;
}

/**
 * Signal that the visitor has sent their first message. This is the
 * "service explicitly requested" moment under ePrivacy, so sessionStorage
 * becomes usable immediately and (in implicit mode) localStorage as well.
 */
export function markInteraction(): void {
  hasInteracted.value = true;
}

/**
 * Host-site API: the visitor has given consent (typically via the host's
 * cookie banner). Unlocks sessionStorage and localStorage immediately,
 * regardless of whether they have interacted with the widget yet.
 */
export function grantConsent(): void {
  explicitGrant.value = true;
}

/**
 * Host-site API: the visitor has withdrawn consent. Wipes any hay-* keys
 * already written to localStorage and clears the DPoP IndexedDB store.
 * sessionStorage stays as-is so the current in-tab chat keeps working.
 */
export function revokeConsent(): void {
  explicitGrant.value = false;
  wipePersistentStorage();
}

function wipePersistentStorage(): void {
  // Remove every hay-* key from localStorage. We intentionally scan the full
  // key list because we don't own a central registry of keys and a namespaced
  // wipe is the safest way to avoid leaving behind stale identifiers after a
  // revoke.
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("hay-")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error("[Webchat] Failed to wipe localStorage on revoke:", error);
  }

  // Clear DPoP signing keys from IndexedDB. Fire-and-forget: we don't block
  // the revoke call on the async DB operation, and any error is logged.
  clearAllKeypairs().catch((error) => {
    console.error("[Webchat] Failed to clear DPoP keys on revoke:", error);
  });
}

/**
 * Reactive consent state and actions for composables.
 */
export function useConsent() {
  return {
    mode,
    hasInteracted,
    canUseSession,
    canUseLocal,
    markInteraction,
    grantConsent,
    revokeConsent,
  };
}

/**
 * Storage wrappers that no-op when the corresponding gate is closed.
 * Session reads return null, session writes/removes silently skip.
 * Same for local. This is the single choke point for every storage call
 * site in the widget.
 */
export const safeStorage = {
  session: {
    getItem(key: string): string | null {
      if (!canUseSession.value) return null;
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (!canUseSession.value) return;
      try {
        sessionStorage.setItem(key, value);
      } catch (error) {
        console.error("[Webchat] sessionStorage.setItem failed:", error);
      }
    },
    removeItem(key: string): void {
      if (!canUseSession.value) return;
      try {
        sessionStorage.removeItem(key);
      } catch (error) {
        console.error("[Webchat] sessionStorage.removeItem failed:", error);
      }
    },
  },
  local: {
    getItem(key: string): string | null {
      if (!canUseLocal.value) return null;
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (!canUseLocal.value) return;
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.error("[Webchat] localStorage.setItem failed:", error);
      }
    },
    removeItem(key: string): void {
      if (!canUseLocal.value) return;
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.error("[Webchat] localStorage.removeItem failed:", error);
      }
    },
  },
};

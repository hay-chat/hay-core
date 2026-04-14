import { describe, it, expect, beforeEach } from "vitest";
import {
  initConsent,
  markInteraction,
  grantConsent,
  revokeConsent,
  safeStorage,
  useConsent,
} from "../useConsent";
import { storeKeypair, getKeypair } from "../useDPoP";

/**
 * Tests for the ePrivacy consent gate. Each test maps to a row in the
 * Consent State Matrix documented in the plan file.
 *
 * The contract we're verifying:
 *   - Before first interaction with no grant: both session and local tiers
 *     behave as no-ops; nothing lands on the visitor's device.
 *   - After first interaction (markInteraction): session tier is unlocked;
 *     local tier depends on mode and explicit grant/revoke state.
 *   - grantConsent() before interaction unlocks both tiers immediately.
 *   - revokeConsent() locks the local tier and wipes any hay-* keys already
 *     written, plus clears the DPoP IndexedDB store.
 *   - sessionStorage stays usable after revoke as long as an interaction has
 *     happened — revoke does not tear down the live in-tab chat.
 */

// Helper: force a synchronous Vue reactivity flush isn't necessary here
// because computed refs update eagerly on read. Just assert directly.

async function makeFakeKeypair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk };
}

describe("useConsent — ePrivacy storage gate", () => {
  beforeEach(() => {
    // Reset consent state to defaults between tests. test-setup.ts handles
    // clearing the underlying storages and IndexedDB factory.
    initConsent("implicit");
  });

  describe("before first interaction", () => {
    it("blocks every storage tier in strict mode with no grant", () => {
      initConsent("strict");
      const { canUseSession, canUseLocal } = useConsent();

      expect(canUseSession.value).toBe(false);
      expect(canUseLocal.value).toBe(false);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.getItem("hay-conversation-id")).toBeNull();
      expect(localStorage.getItem("hay-customer-id")).toBeNull();
      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
    });

    it("blocks every storage tier in implicit mode with no grant", () => {
      initConsent("implicit");
      const { canUseSession, canUseLocal } = useConsent();

      expect(canUseSession.value).toBe(false);
      expect(canUseLocal.value).toBe(false);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
    });

    it("unlocks both tiers immediately when grantConsent is called pre-interaction", () => {
      initConsent("strict");
      grantConsent();

      const { canUseSession, canUseLocal } = useConsent();
      expect(canUseSession.value).toBe(true);
      expect(canUseLocal.value).toBe(true);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
      expect(localStorage.getItem("hay-customer-id")).toBe("cust-1");
    });

    it("returns null from safeStorage reads even when raw storage has data, if the gate is closed", () => {
      // Seed raw storage directly to simulate leftover data from a prior session.
      sessionStorage.setItem("hay-conversation-id", "leftover");
      localStorage.setItem("hay-customer-id", "leftover-customer");

      initConsent("strict");
      // No grant, no interaction.

      expect(safeStorage.session.getItem("hay-conversation-id")).toBeNull();
      expect(safeStorage.local.getItem("hay-customer-id")).toBeNull();
    });
  });

  describe("after first interaction", () => {
    it("implicit mode without revoke: both tiers allowed", () => {
      initConsent("implicit");
      markInteraction();

      const { canUseSession, canUseLocal } = useConsent();
      expect(canUseSession.value).toBe(true);
      expect(canUseLocal.value).toBe(true);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
      expect(localStorage.getItem("hay-customer-id")).toBe("cust-1");
    });

    it("implicit mode after revokeConsent: session still allowed, local blocked", () => {
      initConsent("implicit");
      markInteraction();
      revokeConsent();

      const { canUseSession, canUseLocal } = useConsent();
      expect(canUseSession.value).toBe(true);
      expect(canUseLocal.value).toBe(false);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
      expect(localStorage.getItem("hay-customer-id")).toBeNull();
    });

    it("strict mode without grant: session allowed, local blocked", () => {
      initConsent("strict");
      markInteraction();

      const { canUseSession, canUseLocal } = useConsent();
      expect(canUseSession.value).toBe(true);
      expect(canUseLocal.value).toBe(false);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
      expect(localStorage.getItem("hay-customer-id")).toBeNull();
    });

    it("strict mode after grantConsent: both tiers allowed", () => {
      initConsent("strict");
      markInteraction();
      grantConsent();

      const { canUseSession, canUseLocal } = useConsent();
      expect(canUseSession.value).toBe(true);
      expect(canUseLocal.value).toBe(true);

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
      expect(localStorage.getItem("hay-customer-id")).toBe("cust-1");
    });

    it("strict mode grant then revoke: local goes back to blocked and session stays usable", () => {
      initConsent("strict");
      markInteraction();
      grantConsent();

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");
      expect(localStorage.getItem("hay-customer-id")).toBe("cust-1");

      revokeConsent();

      const { canUseSession, canUseLocal } = useConsent();
      expect(canUseSession.value).toBe(true);
      expect(canUseLocal.value).toBe(false);

      // Session writes still work after revoke
      safeStorage.session.setItem("hay-last-read-message-id", "msg-7");
      expect(sessionStorage.getItem("hay-last-read-message-id")).toBe("msg-7");

      // Local writes blocked
      safeStorage.local.setItem("hay-new-key", "nope");
      expect(localStorage.getItem("hay-new-key")).toBeNull();
    });
  });

  describe("revokeConsent wipes persistent storage", () => {
    it("removes every hay-* key from localStorage", () => {
      initConsent("implicit");
      markInteraction();

      safeStorage.local.setItem("hay-customer-id", "cust-1");
      safeStorage.local.setItem("hay-message-queue", "[]");
      safeStorage.local.setItem("hay-something-else", "data");
      // A non-hay key from the host page — must NOT be touched.
      localStorage.setItem("host-site-key", "keepme");

      expect(localStorage.getItem("hay-customer-id")).toBe("cust-1");

      revokeConsent();

      expect(localStorage.getItem("hay-customer-id")).toBeNull();
      expect(localStorage.getItem("hay-message-queue")).toBeNull();
      expect(localStorage.getItem("hay-something-else")).toBeNull();
      expect(localStorage.getItem("host-site-key")).toBe("keepme");
    });

    it("clears the DPoP IndexedDB store", async () => {
      initConsent("implicit");
      markInteraction();
      grantConsent();

      const kp = await makeFakeKeypair();
      await storeKeypair("conv-revoke-test", kp.privateKey, kp.publicKey, kp.publicJwk);
      const before = await getKeypair("conv-revoke-test");
      expect(before).not.toBeNull();

      revokeConsent();
      // revokeConsent fires clearAllKeypairs() as fire-and-forget — give it a tick.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const after = await getKeypair("conv-revoke-test");
      expect(after).toBeNull();
    });

    it("does not break sessionStorage state written during the same session", () => {
      initConsent("implicit");
      markInteraction();

      safeStorage.session.setItem("hay-conversation-id", "conv-1");
      safeStorage.local.setItem("hay-customer-id", "cust-1");

      revokeConsent();

      // Session state is deliberately preserved so the live chat keeps working.
      expect(sessionStorage.getItem("hay-conversation-id")).toBe("conv-1");
      expect(localStorage.getItem("hay-customer-id")).toBeNull();
    });
  });
});

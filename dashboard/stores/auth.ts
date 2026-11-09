import { logger } from "@/utils/logger";
import { defineStore } from "pinia";
import { HayApi, HayAuthApi } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";
import {
  isDefinitiveAuthFailure,
  SessionEndedError,
  withCrossTabLock,
} from "@/utils/session-refresh";
import {
  clearLegacyRefreshToken,
  extractLegacyTokens,
  getLegacyRefreshToken,
} from "@/utils/legacy-session";
import { askKeyToSign } from "@/utils/webauthn";
import { useSetupStore } from "./setup";
import { useUserStore, type User } from "./user";

type LoginSession = Extract<RouterOutputs["auth"]["login"], { mfaRequired: false }>;

/** Access token, memory only. The refresh token is an HttpOnly cookie. */
interface Tokens {
  accessToken: string;
  expiresAt: number;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    tokens: null as Tokens | null,
    isAuthenticated: false,
    isInitialized: false,
    lastActivity: Date.now(),
    isLoading: false,
    /** A second step left over from a single sign-on return; the login page picks it up. */
    pendingChallenge: null as {
      challengeToken: string;
      methods: { totp: boolean; webauthn: boolean };
    } | null,
  }),
  actions: {
    /**
     * Load the user for a persisted session. Goes through the main client, so
     * an expired access token is refreshed first instead of failing.
     * Offline or server unreachable with a cached user: keep the session and
     * render from cache. Throws (and clears the session) only on a definitive
     * auth failure; rethrows a transient error when there is nothing cached.
     */
    async initializeAuth() {
      try {
        const user = await HayApi.auth.me.query();
        const userStore = useUserStore();
        userStore.setUser(user as User);
        this.isAuthenticated = true;
        this.isInitialized = true;
        this.updateActivity();
      } catch (error) {
        if (isDefinitiveAuthFailure(error)) {
          logger.debug("[Auth] Session rejected, clearing tokens");
          this.tokens = null;
          this.isAuthenticated = false;
          this.isInitialized = true;
          throw error;
        }
        if (useUserStore().user?.id) {
          console.warn("[Auth] Could not reach the server, keeping the cached session:", error);
          this.isAuthenticated = true;
          this.isInitialized = true;
          return;
        }
        throw error;
      }
    },

    async login(email: string, password: string) {
      this.isLoading = true;
      try {
        const result = await HayAuthApi.auth.login.mutate({
          email,
          password,
          useCookie: true,
        });
        if (result.mfaRequired) {
          return { challengeToken: result.challengeToken, methods: result.methods };
        }
        this.applyLogin(result);
        return { challengeToken: null, methods: null };
      } finally {
        this.isLoading = false;
      }
    },

    /** Trade the ticket from the identity provider's return for a session. */
    async completeSsoLogin(ticket: string) {
      this.isLoading = true;
      try {
        const result = await HayAuthApi.auth.sso.exchange.mutate({ ticket, useCookie: true });
        if (result.mfaRequired) {
          this.pendingChallenge = {
            challengeToken: result.challengeToken,
            methods: result.methods,
          };
          return { challengeToken: result.challengeToken, methods: result.methods };
        }
        this.applyLogin(result);
        return { challengeToken: null, methods: null };
      } finally {
        this.isLoading = false;
      }
    },

    /** Second login step, for accounts with two-factor authentication. */
    async verifyMfaLogin(challengeToken: string, code: string) {
      this.isLoading = true;
      try {
        const result = await HayAuthApi.auth.mfa.verifyLogin.mutate({
          challengeToken,
          code,
          useCookie: true,
        });
        this.applyLogin(result);
      } finally {
        this.isLoading = false;
      }
    },

    /** Second login step with a security key or passkey. */
    async verifyWebauthnLogin(challengeToken: string) {
      this.isLoading = true;
      try {
        const optionsJSON = await HayAuthApi.auth.mfa.webauthn.loginOptions.mutate({
          challengeToken,
        });
        const response = await askKeyToSign(optionsJSON);
        const result = await HayAuthApi.auth.mfa.webauthn.verifyLogin.mutate({
          challengeToken,
          response,
          useCookie: true,
        });
        this.applyLogin(result);
      } finally {
        this.isLoading = false;
      }
    },

    applyLogin(result: LoginSession) {
      clearLegacyRefreshToken();
      this.tokens = {
        accessToken: result.accessToken,
        expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
      };
      useUserStore().setUser({
        ...(result.user as User),
        mfaEnrolmentRequired: result.mfaEnrolmentRequired,
      });
      this.isAuthenticated = true;
      this.updateActivity();
    },

    async logout(reason?: string) {
      // A logged-out device must stop getting alerts (customer names on the
      // lock screen): drop the browser subscription here, the server row below.
      let pushEndpoint: string | undefined;
      if (process.client) {
        const { usePushNotifications } = await import("@/composables/usePushNotifications");
        pushEndpoint = await usePushNotifications().releaseForLogout();
      }

      // End this device's session server-side; the refresh cookie is the proof,
      // so this works after the access token expired.
      if (this.isAuthenticated) {
        try {
          await HayAuthApi.auth.logout.mutate({
            refreshToken: getLegacyRefreshToken(),
            useCookie: true,
            pushEndpoint,
          });
        } catch (error) {
          // Ignore errors on logout - the session may already be revoked
          logger.debug("[Auth] Logout API call failed:", error);
        }
      }

      // Clear all auth state but keep isInitialized as true to prevent loading state
      clearLegacyRefreshToken();
      this.tokens = null;
      this.isAuthenticated = false;
      // Don't set isInitialized = false as it causes infinite loading state

      // Clear user store
      const userStore = useUserStore();
      userStore.clearUser();
      // The saved setup board must not reach the next person on this browser.
      useSetupStore().reset();

      // Show notification if there's a reason
      if (reason === "token_expired" && process.client) {
        const nuxtApp = useNuxtApp() as {
          $toast?: { error: (msg: string) => void };
          $i18n?: { t: (key: string) => string };
        };
        const message =
          nuxtApp.$i18n?.t("auth.session.expired") ??
          "Your session has expired. Please login again.";
        if (nuxtApp.$toast) {
          nuxtApp.$toast.error(message);
        }
      }

      await navigateTo(
        reason === "sso_required"
          ? { path: "/login", query: { sso_error: "sso_required" } }
          : "/login",
      );
    },

    updateActivity() {
      this.lastActivity = Date.now();
    },

    async signup(data: {
      organizationName: string;
      email: string;
      fullName: string;
      password: string;
      acceptTerms: boolean;
      acceptMarketing: boolean;
    }) {
      this.isLoading = true;
      try {
        // No session from signup: the user signs in afterwards (once verified, when required).
        return await HayAuthApi.auth.register.mutate({
          organizationName: data.organizationName,
          email: data.email,
          firstName: data.fullName.split(" ")[0],
          lastName: data.fullName.split(" ").slice(1).join(" "),
          password: data.password,
          confirmPassword: data.password,
        });
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * One refresh attempt (retries and the logout decision live in
     * utils/session-refresh via utils/api). Serialized across tabs, so each
     * refresh sends the cookie the previous one just set.
     */
    async refreshTokens() {
      await withCrossTabLock("hay-auth-refresh", async () => {
        if (!this.isAuthenticated) {
          throw new SessionEndedError();
        }

        let result;
        try {
          result = await HayAuthApi.auth.refreshToken.mutate({
            refreshToken: getLegacyRefreshToken(),
            useCookie: true,
          });
        } catch (error) {
          if (isDefinitiveAuthFailure(error)) clearLegacyRefreshToken();
          throw error;
        }
        clearLegacyRefreshToken();

        this.tokens = {
          accessToken: result.accessToken,
          expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
        };

        this.updateActivity();
      });
    },

    /**
     * Login with an access token already obtained (the refresh token, when
     * there is one, was set as a cookie by the same response).
     */
    async loginWithTokens(data: { accessToken: string; expiresIn: number }) {
      this.isLoading = true;
      try {
        // Set tokens first
        this.tokens = {
          accessToken: data.accessToken,
          expiresAt: Date.now() + data.expiresIn * 1000,
        };

        // For URL token auth, we don't have organization context yet
        // The backend will use the user's default/first organization for auth.me
        // We'll get the full organization list from the me response

        // Fetch user data to validate and complete the login
        // Note: This call will work without x-organization-id header
        // because auth.me uses the user's first organization by default
        const user = await HayAuthApi.auth.me.query();

        // Initialize user store and set user data
        const userStore = useUserStore();
        userStore.setUser(user as User);

        this.isAuthenticated = true;
        this.isInitialized = true;
        this.updateActivity();

        logger.debug("[Auth] Successfully logged in with tokens");
      } catch (error) {
        // If validation fails, clear the tokens
        console.error("[Auth] Token validation failed:", error);
        this.tokens = null;
        this.isAuthenticated = false;
        this.isInitialized = true;
        throw error;
      } finally {
        this.isLoading = false;
      }
    },
  },
  persist: {
    // isLoading is per page load and must not come back stuck. Tokens never touch storage.
    pick: ["isAuthenticated", "isInitialized", "lastActivity"],
    beforeHydrate: () => {
      if (typeof window !== "undefined") extractLegacyTokens(window.localStorage);
    },
  },
});

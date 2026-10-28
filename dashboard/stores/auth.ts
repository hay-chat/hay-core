import { defineStore } from "pinia";
import { HayApi, HayAuthApi } from "@/utils/api";
import {
  isDefinitiveAuthFailure,
  SessionEndedError,
  withCrossTabLock,
} from "@/utils/session-refresh";
import { useUserStore, type User } from "./user";
import { useAppStore } from "./app";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Tokens as persisted by pinia-plugin-persistedstate (key = store id). */
function readStoredTokens(): Tokens | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("auth") : null;
    const tokens = raw ? (JSON.parse(raw) as { tokens?: Tokens | null }).tokens : null;
    return tokens?.refreshToken && typeof tokens.expiresAt === "number" ? tokens : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore("auth", {
  state: () => {
    const initialState = {
      tokens: null as Tokens | null,
      isAuthenticated: false,
      isInitialized: false,
      lastActivity: Date.now(),
      isLoading: false,
    };
    console.log("[Auth Store] Initial state:", { hasTokens: !!initialState.tokens });
    return initialState;
  },
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
          console.log("[Auth] Session rejected, clearing tokens");
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
        });
        this.tokens = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
        };
        console.log("[Auth Store] Tokens set after login:", {
          hasAccessToken: !!this.tokens.accessToken,
          hasRefreshToken: !!this.tokens.refreshToken,
          expiresAt: new Date(this.tokens.expiresAt).toISOString(),
        });
        const userStore = useUserStore();
        userStore.setUser(result.user as User);
        this.isAuthenticated = true;
        this.updateActivity();
      } finally {
        this.isLoading = false;
      }
    },

    async logout(reason?: string) {
      // A logged-out device must stop getting alerts (customer names on the
      // lock screen): drop the browser subscription here, the server row below.
      let pushEndpoint: string | undefined;
      if (process.client) {
        const { usePushNotifications } = await import("@/composables/usePushNotifications");
        pushEndpoint = await usePushNotifications().releaseForLogout();
      }

      // End this device's session server-side; the refresh token is the proof,
      // so this works after the access token expired.
      if (this.tokens?.refreshToken) {
        try {
          await HayAuthApi.auth.logout.mutate({
            refreshToken: this.tokens.refreshToken,
            pushEndpoint,
          });
        } catch (error) {
          // Ignore errors on logout - the session may already be revoked
          console.log("[Auth] Logout API call failed:", error);
        }
      }

      // Clear all auth state but keep isInitialized as true to prevent loading state
      this.tokens = null;
      this.isAuthenticated = false;
      // Don't set isInitialized = false as it causes infinite loading state

      // Clear user store
      const userStore = useUserStore();
      userStore.clearUser();

      // Clear onboarding state (so new accounts trigger onboarding flow)
      const appStore = useAppStore();
      appStore.setOnboardingCompleted(false);

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

      await navigateTo("/login");
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
        const result = await HayAuthApi.auth.register.mutate({
          organizationName: data.organizationName,
          email: data.email,
          firstName: data.fullName.split(" ")[0],
          lastName: data.fullName.split(" ").slice(1).join(" "),
          password: data.password,
          confirmPassword: data.password,
        });

        // Store tokens
        this.tokens = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
        };

        // Store user data with organization
        const userStore = useUserStore();
        userStore.setUser(result.user as User);
        this.isAuthenticated = true;
        this.updateActivity();
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * One refresh attempt (retries and the logout decision live in
     * utils/session-refresh via utils/api). Serialized across tabs: a tab that
     * gets the lock after another one rotated adopts the stored tokens instead
     * of sending a refresh token that was just replaced.
     */
    async refreshTokens() {
      await withCrossTabLock("hay-auth-refresh", async () => {
        const stored = readStoredTokens();
        if (stored && this.tokens && stored.expiresAt > this.tokens.expiresAt) {
          this.tokens = stored; // Another tab rotated more recently.
          if (stored.expiresAt - Date.now() > 60_000) return;
        }

        const currentTokens = this.tokens;
        if (!currentTokens?.refreshToken) {
          throw new SessionEndedError();
        }

        const result = await HayAuthApi.auth.refreshToken.mutate({
          refreshToken: currentTokens.refreshToken,
        });

        // Refresh tokens rotate: the old one stops working once its successor is used.
        this.tokens = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
        };

        if (process.client) {
          const token = useCookie("auth-token");
          token.value = result.accessToken;
        }

        this.updateActivity();
        this.$persist?.(); // Write through now, so other tabs see the new pair.
      });
    },

    /**
     * Login using tokens directly (useful for automated testing and direct auth links)
     * This mimics the regular login flow but with pre-existing tokens
     */
    async loginWithTokens(data: { accessToken: string; refreshToken: string; expiresIn: number }) {
      this.isLoading = true;
      try {
        // Set tokens first
        this.tokens = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
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

        console.log("[Auth] Successfully logged in with tokens");
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
  persist: true,
});

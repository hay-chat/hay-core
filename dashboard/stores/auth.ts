import { defineStore } from "pinia";
import { HayAuthApi } from "@/utils/api";
import { useUserStore, type User } from "./user";
import { useAppStore } from "./app";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const useAuthStore = defineStore("auth", {
  state: () => ({
    tokens: null as Tokens | null,
    isAuthenticated: false,
    isInitialized: false,
    lastActivity: Date.now(),
    isLoading: false,
  }),
  getters: {
    isSessionTimedOut: (state) => {
      const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
      return Date.now() - state.lastActivity > SESSION_TIMEOUT;
    },
  },
  actions: {
    async initializeAuth() {
      try {
        const user = await HayAuthApi.auth.me.query();
        const userStore = useUserStore();
        userStore.setUser(user as User);
        this.isAuthenticated = true;
        this.isInitialized = true;
        this.updateActivity();
      } catch (error) {
        console.log("[Auth] Failed to initialize auth, clearing tokens");
        // Clear auth state if initialization fails
        this.tokens = null;
        this.isAuthenticated = false;
        this.isInitialized = true;
        throw error; // Re-throw to let AuthProvider handle the redirect
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
        const userStore = useUserStore();
        userStore.setUser(result.user as User);
        this.isAuthenticated = true;
        this.updateActivity();
      } finally {
        this.isLoading = false;
      }
    },

    async logout(reason?: string) {
      // Only try to call logout API if we have a valid token
      if (this.tokens?.accessToken) {
        try {
          await HayAuthApi.auth.logout.mutate();
        } catch (error) {
          // Ignore errors on logout - token might already be invalid
          console.log("[Auth] Logout API call failed (expected if token expired):", error);
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
        const { $toast } = useNuxtApp() as { $toast?: { error: (msg: string) => void } };
        if ($toast) {
          $toast.error("Your session has expired. Please login again.");
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

    async refreshTokens() {
      // Store refresh token in a local variable to prevent race conditions
      const currentTokens = this.tokens;
      if (!currentTokens?.refreshToken) {
        throw new Error("No refresh token available");
      }

      try {
        const result = await HayAuthApi.auth.refreshToken.mutate({
          refreshToken: currentTokens.refreshToken,
        });

        // Keep the existing refresh token, only update access token
        this.tokens = {
          accessToken: result.accessToken,
          refreshToken: currentTokens.refreshToken, // Keep existing refresh token
          expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
        };

        // Update cookie
        if (process.client) {
          const token = useCookie("auth-token");
          token.value = result.accessToken;
        }

        this.updateActivity();
        return;
      } catch (error) {
        // If refresh fails, clear auth state
        console.error("[Auth] Failed to refresh token:", error);
        throw error;
      }
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

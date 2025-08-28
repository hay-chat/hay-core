import { defineStore } from "pinia";
import { HayApi } from "@/utils/api";
import { useUserStore, type User } from "./user";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const useAuthStore = defineStore("auth", {
  persist: true,
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
        const user = await HayApi.auth.me.query();
        const userStore = useUserStore();
        userStore.setUser(user as User);
        this.isAuthenticated = true;
        this.isInitialized = true;
        this.updateActivity();
      } catch (error) {
        this.isAuthenticated = false;
        this.isInitialized = true;
      }
    },

    async login(email: string, password: string) {
      const result = await HayApi.auth.login.mutate({
        email,
        password,
      });
      this.tokens = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };
      const userStore = useUserStore();
      userStore.setUser(result.user as User);
      this.isAuthenticated = true;
      this.updateActivity();
    },

    async logout(reason?: string) {
      const router = useRouter();
      
      // Only try to call logout API if we have a valid token
      if (this.tokens?.accessToken) {
        try {
          await HayApi.auth.logout.mutate();
        } catch (error) {
          // Ignore errors on logout - token might already be invalid
          console.log('[Auth] Logout API call failed (expected if token expired):', error);
        }
      }

      // Clear all auth state
      this.tokens = null;
      this.isAuthenticated = false;
      this.isInitialized = false;
      
      // Clear user store
      const userStore = useUserStore();
      userStore.clearUser();
      
      // Show notification if there's a reason
      if (reason === 'token_expired' && process.client) {
        const { $toast } = useNuxtApp();
        if ($toast) {
          $toast.error('Your session has expired. Please login again.');
        }
      }

      // Navigate to login page
      if (process.client) {
        await router.push('/login');
      }
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
      const result = await HayApi.auth.register.mutate({
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
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      // Store user data with organization
      const userStore = useUserStore();
      userStore.setUser(result.user as User);
      this.isAuthenticated = true;
      this.updateActivity();
    },

    async refreshTokens() {
      if (!this.tokens?.refreshToken) {
        throw new Error("No refresh token available");
      }

      const result = await HayApi.auth.refreshToken.mutate({
        refreshToken: this.tokens.refreshToken,
      });

      // Keep the existing refresh token, only update access token
      this.tokens = {
        accessToken: result.accessToken,
        refreshToken: this.tokens.refreshToken, // Keep existing refresh token
        expiresAt: Date.now() + result.expiresIn * 1000, // Convert seconds to milliseconds
      };

      // Update cookie
      if (process.client) {
        const token = useCookie("auth-token");
        token.value = result.accessToken;
      }
    },
  },
});

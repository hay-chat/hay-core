import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  User,
  AuthTokens,
  LoginCredentials,
  SignupData,
} from "~/composables/useAuth";
import { apiClient } from "~/utils/api-client";

// API configuration
const getApiBaseUrl = () => {
  const config = useRuntimeConfig();
  return (
    config.public.apiBaseUrl ||
    (() => {
      if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        if (
          hostname.includes("hay.local") ||
          hostname.includes("hay.so") ||
          hostname.includes("hay.ai")
        ) {
          return "";
        }
      }
      return process.env["NODE_ENV"] === "production"
        ? "https://api.hay.so"
        : "http://localhost:3000";
    })()
  );
};

const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes before expiration
const SESSION_TIMEOUT = 60 * 60 * 1000; // 60 minutes of inactivity (increased from 30)

export const useAuthStore = defineStore(
  "auth",
  () => {
    // State
    const user = ref<User | null>(null);
    const tokens = ref<AuthTokens | null>(null);
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const lastActivity = ref(Date.now());
    const isInitialized = ref(false);

    // Getters
    const isAuthenticated = computed(() => {
      // Only consider authenticated if we have both user and valid tokens
      return !!user.value && !!tokens.value && !isTokenExpired.value;
    });

    const currentUser = computed(() => user.value);

    const accessToken = computed(() => {
      const token = tokens.value?.accessToken;
      console.log(
        "AccessToken getter called, token:",
        token ? "exists" : "null"
      );
      return token;
    });

    const isTokenExpired = computed(() => {
      if (!tokens.value) return true;
      // Add a small buffer (30 seconds) to prevent edge cases
      return tokens.value.expiresAt <= Date.now() + 30000;
    });

    const shouldRefreshToken = computed(() => {
      if (!tokens.value) return false;
      return tokens.value.expiresAt - Date.now() <= TOKEN_REFRESH_THRESHOLD;
    });

    const isSessionTimedOut = computed(() => {
      return Date.now() - lastActivity.value > SESSION_TIMEOUT;
    });

    const userRole = computed(() => user.value?.role);

    const organizationId = computed(() => user.value?.organizationId);

    // Actions
    // Update last activity timestamp
    function updateActivity() {
      lastActivity.value = Date.now();
    }

    // Set auth data
    function setAuthData(newUser: User, newTokens: AuthTokens) {
      user.value = newUser;
      tokens.value = newTokens;
      error.value = null;
      updateActivity();
      scheduleTokenRefresh();
    }

    // Clear auth data
    function clearAuthData() {
      user.value = null;
      tokens.value = null;
      error.value = null;
      cancelTokenRefresh();
    }

    // Login using tRPC
    async function login(credentials: LoginCredentials) {
      isLoading.value = true;
      error.value = null;

      try {
        // Debug: Log the incoming data
        console.log("Login credentials received:", credentials);

        // Make sure we have the required fields
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const data = await apiClient.auth.login.mutate({
          email: credentials.email,
          password: credentials.password,
        });

        // Transform the response to match expected format
        const authData = {
          user: {
            id: data.user.id,
            email: data.user.email,
            fullName: data.user.email.split("@")[0], // Default to email prefix
            organizationId: "", // TODO: Add organization support
            organizationName: "",
            role: "user" as const, // TODO: Add role support
            emailVerified: true, // TODO: Add email verification support
            createdAt: data.user.createdAt || new Date().toISOString(),
            updatedAt: data.user.updatedAt || new Date().toISOString(),
          },
          tokens: {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + data.expiresIn * 1000,
          },
        };

        setAuthData(authData.user, authData.tokens);

        return authData;
      } catch (err: any) {
        error.value = err.message || "Login failed";
        clearAuthData();
        throw err;
      } finally {
        isLoading.value = false;
      }
    }

    // Signup using tRPC
    async function signup(signupData: SignupData) {
      isLoading.value = true;
      error.value = null;

      try {
        // Debug: Log the incoming data
        console.log("Signup data received:", signupData);

        // Make sure we have the required fields
        if (!signupData?.email || !signupData?.password) {
          throw new Error("Email and password are required");
        }

        const data = await apiClient.auth.register.mutate({
          email: signupData.email,
          password: signupData.password,
          confirmPassword: signupData.password, // Use same password for confirmation
        });

        // Transform the response to match expected format
        const authData = {
          user: {
            id: data.user.id,
            email: data.user.email,
            fullName: signupData.fullName || data.user.email.split("@")[0],
            organizationId: "", // TODO: Add organization support
            organizationName: signupData.organizationName || "",
            role: "user" as const, // TODO: Add role support
            emailVerified: true, // TODO: Add email verification support
            createdAt: data.user.createdAt || new Date().toISOString(),
            updatedAt: data.user.updatedAt || new Date().toISOString(),
          },
          tokens: {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            expiresAt: Date.now() + data.expiresIn * 1000,
          },
        };

        setAuthData(authData.user, authData.tokens);

        // TODO: Handle organization creation if needed
        // This might need a separate endpoint or be part of the registration process

        return authData;
      } catch (err: any) {
        error.value = err.message || "Signup failed";
        clearAuthData();
        throw err;
      } finally {
        isLoading.value = false;
      }
    }

    // Logout using tRPC
    async function logout() {
      isLoading.value = true;

      try {
        if (tokens.value?.accessToken) {
          try {
            await apiClient.auth.logout.mutate(tokens.value.accessToken);
          } catch (apiError) {
            console.warn("Logout API call failed:", apiError);
          }
        }
      } finally {
        clearAuthData();
        isLoading.value = false;
      }
    }

    // Refresh token using tRPC
    async function refreshToken() {
      if (!tokens.value?.refreshToken) {
        throw new Error("No refresh token available");
      }

      // Prevent multiple simultaneous refresh attempts
      if (isRefreshing) {
        console.log("Token refresh already in progress, skipping...");
        return tokens.value;
      }

      isRefreshing = true;

      try {
        const data = await apiClient.auth.refreshToken.mutate({
          refreshToken: tokens.value.refreshToken,
        });

        const newTokens = {
          accessToken: data.accessToken,
          refreshToken: tokens.value.refreshToken, // Keep the same refresh token
          expiresAt: Date.now() + data.expiresIn * 1000,
        };

        if (user.value) {
          setAuthData(user.value, newTokens);
        }

        return newTokens;
      } catch (err) {
        await logout();
        throw err;
      } finally {
        isRefreshing = false;
      }
    }

    // Validate session using tRPC
    async function validateSession() {
      if (!tokens.value?.accessToken) {
        return false;
      }

      try {
        const userData = await apiClient.auth.me.query(
          tokens.value?.accessToken
        );

        // Transform the response to match our User type
        user.value = {
          id: userData.id,
          email: userData.email,
          fullName: userData.email.split("@")[0], // Default to email prefix if no name
          organizationId: "", // TODO: Add organization support
          organizationName: "",
          role: "user", // TODO: Add role support
          emailVerified: true, // TODO: Add email verification support
          createdAt: new Date().toISOString(),
          updatedAt:
            userData.lastLoginAt?.toISOString() || new Date().toISOString(),
        };

        updateActivity();
        return true;
      } catch (err) {
        console.error("Session validation error:", err);
        return false;
      }
    }

    // Initialize auth from stored tokens
    async function initializeAuth() {
      if (isInitialized.value) {
        return; // Prevent multiple initializations
      }

      isLoading.value = true;

      try {
        console.log("Initializing auth...");
        console.log("Current tokens:", tokens.value);

        // Check if we have persisted tokens
        if (!tokens.value?.accessToken) {
          console.log("No access token found, clearing auth data");
          // No tokens stored, user needs to login
          clearAuthData();
          isInitialized.value = true;
          return;
        }

        // Check if token is expired
        if (isTokenExpired.value) {
          // Try to refresh the token
          if (tokens.value.refreshToken) {
            try {
              await refreshToken();
            } catch (refreshError) {
              console.error("Token refresh failed:", refreshError);
              clearAuthData();
              isInitialized.value = true;
              return;
            }
          } else {
            clearAuthData();
            isInitialized.value = true;
            return;
          }
        }

        // Validate the session with the backend
        const isValid = await validateSession();

        if (isValid && tokens.value) {
          scheduleTokenRefresh();
        } else {
          clearAuthData();
        }
      } catch (err) {
        console.error("Auth initialization error:", err);
        clearAuthData();
      } finally {
        isLoading.value = false;
        isInitialized.value = true;
      }
    }

    // Social login
    async function socialLogin(provider: string) {
      isLoading.value = true;
      error.value = null;

      try {
        if (typeof window !== "undefined") {
          // TODO: Update this to use tRPC OAuth endpoints when available
          window.location.href = `${getApiBaseUrl()}/v1/auth/oauth/${provider}`;
        }
      } catch (err) {
        isLoading.value = false;
        throw err;
      }
    }

    // Forgot password
    async function forgotPassword(_email: string) {
      // TODO: Implement using tRPC when endpoint is available
      throw new Error("Forgot password not yet implemented with tRPC");
    }

    // Token refresh management
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let isRefreshing = false;

    function scheduleTokenRefresh() {
      cancelTokenRefresh();

      if (!tokens.value || isRefreshing) return;

      const timeUntilExpiry = tokens.value.expiresAt - Date.now();
      const refreshTime = timeUntilExpiry - TOKEN_REFRESH_THRESHOLD;

      if (refreshTime > 0) {
        refreshTimer = setTimeout(async () => {
          try {
            await refreshToken();
          } catch (err) {
            console.error("Auto-refresh failed:", err);
            await logout();
          }
        }, refreshTime);
      } else if (timeUntilExpiry > 0) {
        // Token expires soon but not immediately, schedule a short delay
        refreshTimer = setTimeout(async () => {
          try {
            await refreshToken();
          } catch (err) {
            console.error("Immediate token refresh failed:", err);
            await logout();
          }
        }, 1000); // 1 second delay to prevent immediate loop
      }
      // If token is already expired, don't schedule refresh - let the next API call handle it
    }

    function cancelTokenRefresh() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    }

    // Session timeout management
    function startSessionTimer() {
      if (typeof window === "undefined") return;

      // Listen for user activity
      const activityEvents = [
        "mousedown",
        "keydown",
        "scroll",
        "touchstart",
        "mousemove",
      ];

      const handleActivity = () => {
        updateActivity();
      };

      activityEvents.forEach((event) => {
        window.addEventListener(event, handleActivity, { passive: true });
      });

      // Check session timeout periodically (every 5 minutes)
      const sessionCheckInterval = setInterval(() => {
        if (isAuthenticated.value && isSessionTimedOut.value) {
          console.log("Session timed out due to inactivity");
          logout();
          clearInterval(sessionCheckInterval);
        }
      }, 5 * 60 * 1000);

      // Cleanup on page unload
      window.addEventListener("beforeunload", () => {
        clearInterval(sessionCheckInterval);
        activityEvents.forEach((event) => {
          window.removeEventListener(event, handleActivity);
        });
      });
    }

    return {
      // State
      user,
      tokens,
      isLoading,
      error,
      lastActivity,
      isInitialized,

      // Getters
      isAuthenticated,
      currentUser,
      accessToken,
      isTokenExpired,
      shouldRefreshToken,
      isSessionTimedOut,
      userRole,
      organizationId,

      // Actions
      updateActivity,
      setAuthData,
      clearAuthData,
      login,
      signup,
      logout,
      refreshToken,
      validateSession,
      initializeAuth,
      socialLogin,
      forgotPassword,
      scheduleTokenRefresh,
      cancelTokenRefresh,
      startSessionTimer,
    };
  },
  {
    persist: {
      key: "hay-auth",
      pick: ["user", "tokens", "lastActivity", "isInitialized"],
    },
  }
);

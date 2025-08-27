import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { User, AuthTokens, LoginCredentials, SignupData } from '~/composables/useAuth';

// API configuration
const getApiBaseUrl = () => {
  const config = useRuntimeConfig();
  return (
    config.public.apiBaseUrl ||
    (() => {
      if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        if (
          hostname.includes('hay.local') ||
          hostname.includes('hay.so') ||
          hostname.includes('hay.ai')
        ) {
          return '';
        }
      }
      return process.env['NODE_ENV'] === 'production'
        ? 'https://api.hay.so'
        : 'http://localhost:3001';
    })()
  );
};

const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes before expiration
const SESSION_TIMEOUT = 60 * 60 * 1000; // 60 minutes of inactivity (increased from 30)

export const useAuthStore = defineStore(
  'auth',
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
      console.log('AccessToken getter called, token:', token ? 'exists' : 'null');
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

    // Handle API errors
    async function handleApiError(response: Response) {
      try {
        const errorData = await response.json();
        error.value = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
      } catch {
        error.value = `HTTP ${response.status}: ${response.statusText}`;
      }
      throw new Error(error.value || 'An error occurred');
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

    // Login
    async function login(credentials: LoginCredentials) {
      isLoading.value = true;
      error.value = null;

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // Include cookies
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        if (!response.ok) {
          await handleApiError(response);
        }

        const data = await response.json();
        setAuthData(data.user, data.tokens);

        return data;
      } catch (err) {
        clearAuthData();
        throw err;
      } finally {
        isLoading.value = false;
      }
    }

    // Signup
    async function signup(signupData: SignupData) {
      isLoading.value = true;
      error.value = null;

      try {
        const [firstName, lastName] = signupData.fullName.split(' ', 2);

        const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            email: signupData.email,
            password: signupData.password,
            firstName: firstName || signupData.fullName,
            lastName: lastName || '',
          }),
        });

        if (!response.ok) {
          await handleApiError(response);
        }

        const data = await response.json();
        setAuthData(data.user, data.tokens);

        // Create organization if provided
        if (signupData.organizationName && tokens.value) {
          try {
            const orgResponse = await fetch(`${getApiBaseUrl()}/api/v1/auth/organizations`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${tokens.value.accessToken}`,
              },
              credentials: 'include',
              body: JSON.stringify({
                name: signupData.organizationName,
              }),
            });

            if (orgResponse.ok) {
              const orgData = await orgResponse.json();
              if (user.value) {
                user.value = {
                  ...user.value,
                  organizationId: orgData.id,
                  organizationName: orgData.name,
                };
              }
            }
          } catch (orgError) {
            console.warn('Organization creation failed:', orgError);
          }
        }

        return data;
      } catch (err) {
        clearAuthData();
        throw err;
      } finally {
        isLoading.value = false;
      }
    }

    // Logout
    async function logout() {
      isLoading.value = true;

      try {
        if (tokens.value?.accessToken) {
          try {
            await fetch(`${getApiBaseUrl()}/api/v1/auth/logout`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokens.value.accessToken}`,
                'Content-Type': 'application/json',
              },
              credentials: 'include',
            });
          } catch (apiError) {
            console.warn('Logout API call failed:', apiError);
          }
        }
      } finally {
        clearAuthData();
        isLoading.value = false;
      }
    }

    // Refresh token
    async function refreshToken() {
      if (!tokens.value?.refreshToken) {
        throw new Error('No refresh token available');
      }

      // Prevent multiple simultaneous refresh attempts
      if (isRefreshing) {
        console.log('Token refresh already in progress, skipping...');
        return tokens.value;
      }

      isRefreshing = true;

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            refreshToken: tokens.value.refreshToken,
          }),
        });

        if (!response.ok) {
          await handleApiError(response);
        }

        const data = await response.json();

        if (user.value) {
          setAuthData(user.value, data.tokens);
        }

        return data.tokens;
      } catch (err) {
        await logout();
        throw err;
      } finally {
        isRefreshing = false;
      }
    }

    // Validate session
    async function validateSession() {
      if (!tokens.value?.accessToken) {
        return false;
      }

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/me`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${tokens.value.accessToken}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (response.ok) {
          const userData = await response.json();
          user.value = userData.user;
          updateActivity();
          return true;
        }

        return false;
      } catch (err) {
        console.error('Session validation error:', err);
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
        console.log('Initializing auth...');
        console.log('Current tokens:', tokens.value);

        // Check if we have persisted tokens
        if (!tokens.value?.accessToken) {
          console.log('No access token found, clearing auth data');
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
              console.error('Token refresh failed:', refreshError);
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
        console.error('Auth initialization error:', err);
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
        if (typeof window !== 'undefined') {
          window.location.href = `${getApiBaseUrl()}/api/v1/auth/oauth/${provider}`;
        }
      } catch (err) {
        isLoading.value = false;
        throw err;
      }
    }

    // Forgot password
    async function forgotPassword(email: string) {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/password/reset-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        await handleApiError(response);
      }
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
            console.error('Auto-refresh failed:', err);
            await logout();
          }
        }, refreshTime);
      } else if (timeUntilExpiry > 0) {
        // Token expires soon but not immediately, schedule a short delay
        refreshTimer = setTimeout(async () => {
          try {
            await refreshToken();
          } catch (err) {
            console.error('Immediate token refresh failed:', err);
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
      if (typeof window === 'undefined') return;

      // Listen for user activity
      const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

      const handleActivity = () => {
        updateActivity();
      };

      activityEvents.forEach((event) => {
        window.addEventListener(event, handleActivity, { passive: true });
      });

      // Check session timeout periodically (every 5 minutes)
      const sessionCheckInterval = setInterval(
        () => {
          if (isAuthenticated.value && isSessionTimedOut.value) {
            console.log('Session timed out due to inactivity');
            logout();
            clearInterval(sessionCheckInterval);
          }
        },
        5 * 60 * 1000,
      );

      // Cleanup on page unload
      window.addEventListener('beforeunload', () => {
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
      handleApiError,
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
      key: 'hay-auth',
      pick: ['user', 'tokens', 'lastActivity', 'isInitialized'],
    },
  },
);

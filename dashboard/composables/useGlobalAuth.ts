import { computed } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useUserStore } from '~/stores/user';

// Global auth composable that provides centralized auth state management
export function useGlobalAuth() {
  const authStore = useAuthStore();
  const userStore = useUserStore();

  // Computed properties for reactive auth state
  const isAuthenticated = computed(() => authStore.isAuthenticated);
  const user = computed(() => authStore.user);
  const isLoading = computed(() => authStore.isLoading);
  const error = computed(() => authStore.error);
  const isInitialized = computed(() => authStore.isInitialized);

  // Initialize auth if not already done
  const initialize = async () => {
    if (!authStore.isInitialized) {
      try {
        await authStore.initializeAuth();

        if (authStore.isAuthenticated) {
          await userStore.initializeUserData();
        }

        // Start session timer
        authStore.startSessionTimer();

        return true;
      } catch (error) {
        console.error('Global auth initialization failed:', error);
        return false;
      }
    }
    return true;
  };

  // Login wrapper
  const login = async (credentials: any) => {
    try {
      await authStore.login(credentials);
      if (authStore.isAuthenticated) {
        await userStore.initializeUserData();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  };

  // Logout wrapper
  const logout = async () => {
    try {
      await authStore.logout();
      userStore.clearUserData();
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  };

  // Refresh token wrapper
  const refreshToken = async () => {
    try {
      await authStore.refreshToken();
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  };

  return {
    // State
    isAuthenticated,
    user,
    isLoading,
    error,
    isInitialized,

    // Store references for direct access when needed
    authStore,
    userStore,

    // Methods
    initialize,
    login,
    logout,
    refreshToken,
  };
}

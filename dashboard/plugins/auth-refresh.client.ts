import { useAuthStore } from '@/stores/auth';

export default defineNuxtPlugin(() => {
  const authStore = useAuthStore();
  let refreshInterval: NodeJS.Timeout | null = null;

  // Function to check if token needs refresh
  const checkTokenExpiration = () => {
    if (!authStore.isAuthenticated || !authStore.tokens?.expiresAt) {
      return;
    }

    const timeUntilExpiry = authStore.tokens.expiresAt - Date.now();
    
    // If token expires in less than 2 minutes, refresh it
    if (timeUntilExpiry < 120000 && timeUntilExpiry > 0) {
      console.log('[Auth Refresh Plugin] Token expiring soon, refreshing...');
      authStore.refreshTokens().catch((error) => {
        console.error('[Auth Refresh Plugin] Failed to refresh token:', error);
      });
    }
  };

  // Start periodic check when authenticated
  const startTokenRefreshCheck = () => {
    // Clear any existing interval
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }

    // Check every 30 seconds
    refreshInterval = setInterval(() => {
      checkTokenExpiration();
    }, 30000);

    // Also check immediately
    checkTokenExpiration();
  };

  // Stop periodic check
  const stopTokenRefreshCheck = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  };

  // Watch authentication state
  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (isAuthenticated) {
        startTokenRefreshCheck();
      } else {
        stopTokenRefreshCheck();
      }
    },
    { immediate: true }
  );

  // Clean up on unmount
  if (process.client) {
    window.addEventListener('beforeunload', () => {
      stopTokenRefreshCheck();
    });
  }
});
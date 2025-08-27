export default defineNuxtPlugin(async (nuxtApp) => {
  // Only run on client side to avoid SSR issues
  if (typeof window !== 'undefined') {
    const { useAuthStore } = await import('~/stores/auth');
    const { useUserStore } = await import('~/stores/user');

    const authStore = useAuthStore();
    const userStore = useUserStore();

    // Wait for the app to be ready
    await nuxtApp.hooks.callHook('app:created', nuxtApp as any);

    try {
      console.log('Auth plugin starting initialization...');
      console.log('Initial auth store state:', {
        isAuthenticated: authStore.isAuthenticated,
        hasTokens: !!authStore.tokens,
        hasUser: !!authStore.user,
        isInitialized: authStore.isInitialized,
      });

      // Initialize authentication state from stored tokens on client-side
      await authStore.initializeAuth();

      console.log('After initialization:', {
        isAuthenticated: authStore.isAuthenticated,
        hasTokens: !!authStore.tokens,
        hasUser: !!authStore.user,
        isInitialized: authStore.isInitialized,
        accessToken: authStore.accessToken ? 'exists' : 'null',
      });

      // If authenticated, load user data
      if (authStore.isAuthenticated) {
        await userStore.initializeUserData();
      }

      // Start session timer for activity tracking
      authStore.startSessionTimer();

      console.log('Auth plugin initialized successfully');
    } catch (error) {
      console.error('Auth plugin initialization failed:', error);
      // Clear any invalid state
      authStore.clearAuthData();
      userStore.clearUserData();
    }
  }
});

import { useAuthStore } from '~/stores/auth';

export default defineNuxtRouteMiddleware((to, from) => {
  const authStore = useAuthStore();

  // Wait for auth to be initialized
  if (!authStore.isInitialized) {
    // If auth is not initialized yet, wait a bit and check again
    // This prevents redirects during the initial load
    return new Promise((resolve) => {
      const checkAuth = () => {
        if (authStore.isInitialized) {
          resolve(navigateTo('/login'));
        } else {
          setTimeout(checkAuth, 100);
        }
      };
      checkAuth();
    });
  }

  // If user is not authenticated, redirect to login
  if (!authStore.isAuthenticated) {
    return navigateTo('/login');
  }

  // Update activity timestamp
  authStore.updateActivity();

  // Check session timeout
  if (authStore.isSessionTimedOut) {
    authStore.logout();
    return navigateTo('/login');
  }
});

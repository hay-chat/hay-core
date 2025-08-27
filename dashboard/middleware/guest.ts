import { useAuthStore } from '~/stores/auth';

export default defineNuxtRouteMiddleware((_to, _from) => {
  const authStore = useAuthStore();

  // If user is authenticated, redirect to dashboard
  if (authStore.isAuthenticated) {
    return navigateTo('/');
  }
});

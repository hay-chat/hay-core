import { useAuthStore } from "@/stores/auth";

export default defineNuxtPlugin((nuxtApp: any) => {
  // Handle Vue errors
  nuxtApp.vueApp.config.errorHandler = (error: any, instance: any, info: string) => {
    console.error('[Global Error Handler]', error, info);
    
    // Check if error is related to authentication
    if (error instanceof Error) {
      const message = error.message?.toLowerCase();
      
      if (
        message?.includes('token has expired') ||
        message?.includes('token expired') ||
        message?.includes('unauthorized') ||
        message?.includes('authentication required')
      ) {
        const authStore = useAuthStore();
        
        // Only logout if authenticated to avoid loops
        if (authStore.isAuthenticated) {
          console.log('[Error Handler] Authentication error detected, logging out');
          authStore.logout('token_expired');
        }
      }
    }
  };
  
  // Handle unhandled promise rejections
  if (process.client) {
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[Unhandled Promise Rejection]', event.reason);
      
      // Check if the rejection is due to authentication issues
      const reason = event.reason;
      if (reason && typeof reason === 'object' && 'message' in reason) {
        const message = String(reason.message).toLowerCase();
        
        if (
          message.includes('token has expired') ||
          message.includes('token expired') ||
          message.includes('unauthorized')
        ) {
          const authStore = useAuthStore();
          
          if (authStore.isAuthenticated) {
            console.log('[Unhandled Rejection] Token expired, logging out');
            authStore.logout('token_expired');
          }
          
          // Prevent default browser error handling
          event.preventDefault();
        }
      }
    });
  }
});
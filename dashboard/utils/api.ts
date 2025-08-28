import type { AppRouter } from "@/types/trpc";
import type { TRPCLink } from "@trpc/client";

import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

// Helper function to get auth cookie
function getAuthToken(): string {
  const authStore = useAuthStore();
  return authStore.tokens?.accessToken
    ? `Bearer ${authStore.tokens.accessToken}`
    : "";
}

function getOrganizationId(): string {
  const userStore = useUserStore();
  return userStore.activeOrganization?.id || "";
}

// Error link to handle token expiration
const errorLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      const unsubscribe = next(op).subscribe({
        next(value) {
          observer.next(value);
        },
        error(err) {
          // Check if the error is due to token expiration
          if (err instanceof TRPCClientError) {
            const message = err.message?.toLowerCase();
            const data = err.data;
            
            // Check for token expiration in various formats
            if (
              message?.includes('token has expired') ||
              message?.includes('token expired') ||
              message?.includes('jwt expired') ||
              data?.code === 'UNAUTHORIZED' ||
              (data?.httpStatus === 401 && message?.includes('expired'))
            ) {
              // Token has expired, trigger logout
              const authStore = useAuthStore();
              
              // Only logout if we're authenticated (to avoid loops)
              if (authStore.isAuthenticated) {
                console.log('[API] Token expired, logging out user');
                
                // Use setTimeout to ensure we're not in a reactive context
                if (typeof window !== 'undefined') {
                  setTimeout(() => {
                    authStore.logout('token_expired');
                  }, 0);
                }
              }
            }
          }
          
          observer.error(err);
        },
        complete() {
          observer.complete();
        },
      });
      
      return unsubscribe;
    });
  };
};

export const HayApi = createTRPCClient<AppRouter>({
  links: [
    errorLink,
    httpLink({
      url: "http://localhost:3000/v1",
      // You can pass any HTTP headers you wish here
      async headers() {
        return {
          authorization: getAuthToken(),
          "x-organization-id": getOrganizationId(),
        };
      },
    }),
  ],
});

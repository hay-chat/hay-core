import type { AppRouter } from "@/types/trpc";
import type { TRPCLink } from "@trpc/client";

import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

// Helper function to get auth cookie
function getAuthToken(): string {
  const authStore = useAuthStore();
  return authStore.tokens?.accessToken ? `Bearer ${authStore.tokens.accessToken}` : "";
}

function getOrganizationId(): string {
  const userStore = useUserStore();
  return userStore.activeOrganization?.id || "";
}

// Check if token is about to expire (within 1 minute)
function isTokenExpiringSoon(): boolean {
  const authStore = useAuthStore();
  if (!authStore.tokens?.expiresAt) return false;

  const timeUntilExpiry = authStore.tokens.expiresAt - Date.now();
  return timeUntilExpiry < 60000; // Less than 1 minute
}

// Track if we're currently refreshing to avoid multiple refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<void> | null = null;

// Refresh the access token
async function refreshTokenIfNeeded(): Promise<void> {
  const authStore = useAuthStore();

  // If not authenticated or no refresh token, skip
  if (!authStore.isAuthenticated || !authStore.tokens?.refreshToken) {
    return;
  }

  // Check if token is expiring soon
  if (!isTokenExpiringSoon()) {
    return;
  }

  // Check if there's a refresh token available before attempting refresh
  if (!authStore.tokens?.refreshToken) {
    console.log("[API] No refresh token available, skipping refresh");
    if (typeof window !== "undefined") {
      setTimeout(() => {
        authStore.logout("token_expired");
      }, 0);
    }
    return Promise.reject(new Error("No refresh token available"));
  }

  // If already refreshing, wait for the existing refresh to complete
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;

  refreshPromise = authStore
    .refreshTokens()
    .then(() => {
      console.log("[API] Token refreshed successfully");
    })
    .catch((error) => {
      console.error("[API] Failed to refresh token:", error);
      // If refresh fails, logout the user
      if (typeof window !== "undefined") {
        setTimeout(() => {
          authStore.logout("token_expired");
        }, 0);
      }
    })
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
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
              message?.includes("token has expired") ||
              message?.includes("token expired") ||
              message?.includes("jwt expired") ||
              data?.code === "UNAUTHORIZED" ||
              (data?.httpStatus === 401 && message?.includes("expired"))
            ) {
              // Token has expired, trigger logout
              const authStore = useAuthStore();

              // Only logout if we're authenticated (to avoid loops)
              if (authStore.isAuthenticated) {
                console.log("[API] Token expired, logging out user");

                // Use setTimeout to ensure we're not in a reactive context
                if (typeof window !== "undefined") {
                  setTimeout(() => {
                    authStore.logout("token_expired");
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

// Token refresh link to check and refresh token before requests
const tokenRefreshLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      // Check and refresh token before making the request
      refreshTokenIfNeeded()
        .then(() => {
          // Continue with the request after token refresh (if needed)
          const unsubscribe = next(op).subscribe({
            next(value) {
              observer.next(value);
            },
            error(err) {
              observer.error(err);
            },
            complete() {
              observer.complete();
            },
          });

          return unsubscribe;
        })
        .catch((error) => {
          observer.error(error);
        });
    });
  };
};

// Get API base URL - this will be replaced at build time by Nuxt
const API_BASE_URL =
  process.env.NODE_ENV === "development" ? "http://localhost:3001/v1" : "https://api.hay.chat/v1";

// Create a base client without token refresh for auth endpoints
export const HayAuthApi = createTRPCClient<AppRouter>({
  links: [
    errorLink, // Handle errors including expired tokens
    httpLink({
      url: API_BASE_URL,
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

// Main API client with token refresh middleware
export const HayApi = createTRPCClient<AppRouter>({
  links: [
    tokenRefreshLink, // Check token before requests
    errorLink, // Handle errors including expired tokens
    httpLink({
      url: API_BASE_URL,
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

// Export alias for backward compatibility
export const Hay = HayApi;

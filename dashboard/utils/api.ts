import type { AppRouter } from "@/types/trpc";
import type { TRPCLink } from "@trpc/client";

import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { reportServerError } from "@/composables/useServerStatus";
import { redirectForSuspension, SUSPENDED_ROUTE } from "@/composables/useSuspension";
import {
  createRefreshCoordinator,
  isDefinitiveAuthFailure,
  isUnauthorizedError,
} from "./session-refresh";

// Helper function to get auth cookie
function getAuthToken(): string {
  const authStore = useAuthStore();
  return authStore.tokens?.accessToken ? `Bearer ${authStore.tokens.accessToken}` : "";
}

function getOrganizationId(): string {
  const userStore = useUserStore();
  const orgId = userStore.activeOrganization?.id || "";

  // If no org ID and we're authenticated, try to get it from the first organization
  if (!orgId && userStore.user?.organizations?.length) {
    return userStore.user.organizations[0].id;
  }

  return orgId;
}

/**
 * One refresh at a time for the whole tab (and, via a Web Lock in the store,
 * across tabs). Logout happens here and only here: when the server rejects
 * the refresh token. Network errors, timeouts and 5xx keep the session.
 */
const sessionRefresh = createRefreshCoordinator({
  refresh: () => useAuthStore().refreshTokens(),
  onAuthFailure: () => {
    // Out of the current call stack: logout navigates.
    setTimeout(() => {
      useAuthStore().logout("token_expired");
    }, 0);
  },
});

/**
 * Make sure the access token is good for at least `minValidityMs`.
 * Rejects only when the token is already expired and no refresh succeeded;
 * a still-valid token is used even if the refresh could not reach the server.
 */
export async function ensureFreshAccessToken(minValidityMs = 60_000): Promise<void> {
  const tokens = useAuthStore().tokens;
  if (!tokens?.refreshToken) return;
  if (tokens.expiresAt - Date.now() > minValidityMs) return;

  try {
    await sessionRefresh.refresh();
  } catch (error) {
    const current = useAuthStore().tokens;
    if (!isDefinitiveAuthFailure(error) && current && current.expiresAt > Date.now()) return;
    throw error;
  }
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
          // Check if the error is due to authentication failure
          if (err instanceof TRPCClientError) {
            const message = err.message?.toLowerCase();
            const data = err.data;

            // Debug logging
            console.log("[API Error Link] Error detected:", {
              message: err.message,
              messageLower: message,
              code: data?.code,
              httpStatus: data?.httpStatus,
              fullData: data,
            });

            // The organization was suspended by the operator: lock the dashboard.
            if (data?.code === "FORBIDDEN" && data?.type === "ORGANIZATION_SUSPENDED") {
              const userStore = useUserStore();
              userStore.markActiveOrganizationSuspended(data.reason ?? null);

              if (
                typeof window !== "undefined" &&
                !window.location.pathname.startsWith(SUSPENDED_ROUTE)
              ) {
                const organization = userStore.activeOrganization;
                setTimeout(async () => {
                  const redirected = organization
                    ? await redirectForSuspension(organization)
                    : false;
                  if (!redirected) navigateTo(SUSPENDED_ROUTE);
                }, 0);
              }

              observer.error(err);
              return;
            }

            // UNAUTHORIZED is handled by tokenRefreshLink: refresh, then retry.
            // Only a rejected refresh logs the user out (see sessionRefresh).

            // Network-level failure (no response) or 5xx => the server may be down.
            // Trigger an immediate health check so the banner appears without waiting
            // for the next poll. The health check itself confirms, so a transient blip
            // won't flip the banner on its own. 4xx app errors are left alone.
            const httpStatus = data?.httpStatus;
            if (httpStatus === undefined || httpStatus >= 500) {
              reportServerError();
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

/**
 * Refresh the access token before a request when it is about to expire, and
 * once more when a request comes back UNAUTHORIZED (then retry it once). A 401
 * means the request was never executed, so the retry is safe for mutations.
 */
export const tokenRefreshLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      let cancelled = false;
      let unsubscribe: (() => void) | undefined;

      const forward = (isRetry: boolean) => {
        const subscription = next(op).subscribe({
          next(value) {
            observer.next(value);
          },
          error(err) {
            if (isRetry || !isUnauthorizedError(err) || !useAuthStore().tokens?.refreshToken) {
              observer.error(err);
              return;
            }
            sessionRefresh.refresh().then(
              () => {
                if (!cancelled) forward(true);
              },
              () => observer.error(err),
            );
          },
          complete() {
            observer.complete();
          },
        });
        unsubscribe = () => subscription.unsubscribe();
      };

      ensureFreshAccessToken().then(
        () => {
          if (!cancelled) forward(false);
        },
        (error) => observer.error(TRPCClientError.from(error)),
      );

      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    });
  };
};

// Get API base URL from runtime config (lazy getter)
function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    // Client-side: use runtime config
    const config = useRuntimeConfig();
    return `${config.public.apiBaseUrl}/v1`;
  }
  // Server-side fallback (shouldn't be used since SSR is disabled)
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001/v1"
    : "http://localhost:3001/v1";
}

// Lazy client singletons
let _hayAuthApi: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;
let _hayApi: ReturnType<typeof createTRPCClient<AppRouter>> | null = null;

// Create a base client without token refresh for auth endpoints (lazy)
function createHayAuthApi() {
  if (!_hayAuthApi) {
    _hayAuthApi = createTRPCClient<AppRouter>({
      links: [
        errorLink, // Handle errors including expired tokens
        httpLink({
          url: getApiBaseUrl(),
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
  }
  return _hayAuthApi;
}

// Main API client with token refresh middleware (lazy)
function createHayApi() {
  if (!_hayApi) {
    _hayApi = createTRPCClient<AppRouter>({
      links: [
        tokenRefreshLink, // Check token before requests
        errorLink, // Handle errors including expired tokens
        httpLink({
          url: getApiBaseUrl(),
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
  }
  return _hayApi;
}

/**
 * Fetch a private upload (conversation media) through the authenticated
 * /v1/media/:id route. Browsers can't attach the session to <img src>, so the
 * bytes are fetched here and rendered from an object URL.
 * Resolves null when the server has no such upload for this organization.
 */
export async function fetchMedia(uploadId: string): Promise<Blob | null> {
  const response = await fetch(`${getApiBaseUrl()}/media/${encodeURIComponent(uploadId)}`, {
    headers: {
      authorization: getAuthToken(),
      "x-organization-id": getOrganizationId(),
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Media request failed with status ${response.status}`);
  }
  return response.blob();
}

// Export lazy getters
export const HayAuthApi = new Proxy({} as ReturnType<typeof createTRPCClient<AppRouter>>, {
  get(_target, prop) {
    return createHayAuthApi()[prop as keyof ReturnType<typeof createTRPCClient<AppRouter>>];
  },
});

export const HayApi = new Proxy({} as ReturnType<typeof createTRPCClient<AppRouter>>, {
  get(_target, prop) {
    return createHayApi()[prop as keyof ReturnType<typeof createTRPCClient<AppRouter>>];
  },
});

// Export main API client with dynamic plugin support
// Plugin routers are dynamically added at runtime and accessed via bracket notation
// Example: Hay['cloud']?.billing?.getSubscription()
export const Hay = HayApi;

import type { AppRouter } from "@/types/trpc";

import { createTRPCClient, httpLink } from "@trpc/client";
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

export const HayApi = createTRPCClient<AppRouter>({
  links: [
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

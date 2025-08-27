import type { AppRouter } from "@/types/trpc";

import { createTRPCClient, httpLink } from "@trpc/client";

// Helper function to get auth cookie
function getAuthCookie(): string {
  if (process.client) {
    const token = useCookie("auth-token");
    return token.value ? `Bearer ${token.value}` : "";
  }
  return "";
}

export const HayApi = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: "http://localhost:3000/v1",
      // You can pass any HTTP headers you wish here
      async headers() {
        return {
          authorization: getAuthCookie(),
        };
      },
    }),
  ],
});

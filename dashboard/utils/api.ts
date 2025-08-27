import type { AppRouter } from "../../server/routes";

import { createTRPCClient, httpLink } from "@trpc/client";

export const HayApi = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: "http://localhost:3000/",
      // You can pass any HTTP headers you wish here
      async headers() {
        return {
          authorization: getAuthCookie(),
        };
      },
    }),
  ],
});

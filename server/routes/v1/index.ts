import { router } from "@/trpc";

export const v1Router = router({
  // auth: authRouter,
});

export type V1Router = typeof v1Router;

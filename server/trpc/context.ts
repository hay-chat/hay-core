import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { authenticate } from "@server/lib/auth/middleware";

export interface Context {
  user: AuthUser | null;
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
}

export const createContext = async ({
  req,
  res,
}: CreateExpressContextOptions): Promise<Context> => {
  // Authenticate the request
  let user: AuthUser | null = null;

  try {
    user = await authenticate(req);
  } catch (error) {
    // Log authentication errors but don't fail context creation
    console.error("[Context] Authentication error:", error);
    // Authentication errors will be handled by procedures that require auth
  }

  const context: Context = {
    user,
    req,
    res,
  };

  return context;
};

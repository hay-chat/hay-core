import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { authenticate } from "@server/lib/auth/middleware";
import type { ListParams } from "./middleware/pagination";

export interface Context {
  user: AuthUser | null;
  organizationId: string | null;
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  listParams?: ListParams; // Added by pagination middleware
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
    if (error instanceof Error) {
      console.error("[Context] Authentication error:", error.message);

      // Store the error for procedures that require auth
      // This allows us to provide better error messages
      if (
        error.message.includes("Token has expired") ||
        error.message.includes("token expired")
      ) {
        // We'll let the auth middleware handle this with proper TRPC error
        (req as any).authError = error.message;
      }
    } else {
      console.error("[Context] Authentication error:", error);
    }
    // Authentication errors will be handled by procedures that require auth
  }

  // Extract organizationId from header
  const organizationId =
    (req.headers["x-organization-id"] as string | null) || null;

  const context: Context = {
    user,
    organizationId,
    req,
    res,
  };

  return context;
};

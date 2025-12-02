import { Request, Response, NextFunction } from "express";
import { requireAuth, requireAdmin } from "@server/lib/auth/middleware";
import { AuthUser } from "@server/lib/auth/AuthUser";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      organizationId?: string;
    }
  }
}

/**
 * Express middleware for authenticated endpoints
 * Reuses tRPC's authentication logic
 */
export const withAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Reuse existing requireAuth function
    const user = await requireAuth(req);

    // Extract organizationId from header
    const organizationId = req.headers["x-organization-id"] as string | undefined;

    if (!organizationId) {
      res.status(400).json({
        error: "x-organization-id header required",
      });
      return;
    }

    // Populate request object
    req.user = user;
    req.organizationId = organizationId;

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication required";
    res.status(401).json({ error: message });
  }
};

/**
 * Express middleware for admin-only endpoints
 */
export const withAdminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // First authenticate
    const user = await requireAuth(req);
    const organizationId = req.headers["x-organization-id"] as string | undefined;

    if (!organizationId) {
      res.status(400).json({ error: "x-organization-id header required" });
      return;
    }

    // Check admin permissions
    requireAdmin(user);

    // Populate request
    req.user = user;
    req.organizationId = organizationId;

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication required";
    const status = message.includes("Admin") ? 403 : 401;
    res.status(status).json({ error: message });
  }
};

/**
 * Optional auth middleware (doesn't fail if not authenticated)
 */
export const withOptionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const user = await requireAuth(req);
    const organizationId = req.headers["x-organization-id"] as string | undefined;

    req.user = user;
    req.organizationId = organizationId;
  } catch {
    // Silently continue without auth
  }

  next();
};

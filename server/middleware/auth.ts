import { Request, Response, NextFunction } from "express";
import { requireAuth, requireAdmin } from "@server/lib/auth/middleware";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { TRPCError } from "@trpc/server";
import { mfaService } from "@server/services/mfa.service";

const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function parseOrganizationIdHeader(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || !ORGANIZATION_ID_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
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
export const withAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Reuse existing requireAuth function
    const user = await requireAuth(req);

    // Extract organizationId from header
    const organizationId = parseOrganizationIdHeader(req.headers["x-organization-id"]);

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
    const organizationId = parseOrganizationIdHeader(req.headers["x-organization-id"]);

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
 * Express counterpart of the `requireMfaStepUp` tRPC middleware. Goes after
 * `withAuth` or `withAdminAuth`.
 */
export const withMfaStepUp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await mfaService.assertStepUp(req.user!);
    next();
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      res.status(403).json({
        error: error.message,
        type: (error.cause as { type?: string } | undefined)?.type,
      });
      return;
    }
    next(error);
  }
};

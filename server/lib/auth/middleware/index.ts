import { AuthUser } from "@server/lib/auth/AuthUser";
import { authenticateBasicAuth } from "./basicAuth";
import { authenticateBearerAuth } from "./bearerAuth";
import { authenticateApiKeyAuth } from "./apiKeyAuth";
import type { Request } from "express";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";

/**
 * Load UserOrganization relationship for multi-org context
 */
async function loadUserOrganization(
  userId: string,
  organizationId: string,
): Promise<UserOrganization | undefined> {
  const userOrgRepository = AppDataSource.getRepository(UserOrganization);

  const userOrg = await userOrgRepository.findOne({
    where: {
      userId,
      organizationId,
      isActive: true,
    },
    relations: ["organization"],
  });

  return userOrg || undefined;
}

/**
 * Enhance AuthUser with organization context
 */
async function enhanceWithOrgContext(
  baseAuthUser: AuthUser,
  req: Request,
): Promise<AuthUser> {
  const organizationId = req.headers["x-organization-id"] as string | undefined;

  // If no organization header, return base AuthUser
  if (!organizationId) {
    return baseAuthUser;
  }

  // Load UserOrganization relationship
  const userOrg = await loadUserOrganization(baseAuthUser.id, organizationId);

  // If user doesn't belong to this organization, throw error
  if (!userOrg) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "User does not belong to the specified organization",
    });
  }

  // Get the full user with relations
  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({
    where: { id: baseAuthUser.id },
  });

  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "User not found",
    });
  }

  // Create new AuthUser with organization context
  return new AuthUser(user, baseAuthUser.authMethod, {
    sessionId: baseAuthUser.sessionId,
    apiKeyId: baseAuthUser.apiKeyId,
    scopes: baseAuthUser.scopes,
    organizationId,
    userOrganization: userOrg,
  });
}

/**
 * Main authentication middleware that tries all authentication methods
 * Returns AuthUser if authenticated, null otherwise
 */
export async function authenticate(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return null;
  }

  try {
    let baseAuthUser: AuthUser | null = null;

    // Try Bearer token authentication first (most common)
    if (authHeader.startsWith("Bearer ")) {
      baseAuthUser = await authenticateBearerAuth(authHeader);
      if (baseAuthUser) {
        logAuthSuccess("jwt", baseAuthUser.id);
      }
    }

    // Try Basic authentication
    if (!baseAuthUser && authHeader.startsWith("Basic ")) {
      const result = await authenticateBasicAuth(authHeader);
      if (result) {
        // Store tokens in response headers for the client
        if (req.res) {
          req.res.setHeader("X-Access-Token", result.tokens.accessToken);
          req.res.setHeader("X-Refresh-Token", result.tokens.refreshToken);
          req.res.setHeader("X-Token-Expires-In", result.tokens.expiresIn.toString());
        }
        baseAuthUser = result.user;
        logAuthSuccess("basic", baseAuthUser.id);
      }
    }

    // Try API key authentication
    if (
      !baseAuthUser &&
      (authHeader.startsWith("ApiKey ") ||
        (authHeader.startsWith("Bearer ") && authHeader.includes("hay_")))
    ) {
      baseAuthUser = await authenticateApiKeyAuth(authHeader);
      if (baseAuthUser) {
        logAuthSuccess("apikey", baseAuthUser.id);
      }
    }

    // If no authentication succeeded, return null
    if (!baseAuthUser) {
      return null;
    }

    // Enhance with organization context if organizationId header is present
    return await enhanceWithOrgContext(baseAuthUser, req);
  } catch (error) {
    logAuthFailure(authHeader.split(" ")[0], error);
    throw error;
  }
}

/**
 * Require authentication - throws error if not authenticated
 */
export async function requireAuth(req: Request): Promise<AuthUser> {
  const authUser = await authenticate(req);

  if (!authUser) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }

  return authUser;
}

/**
 * Optional authentication - returns null if not authenticated
 */
export async function optionalAuth(req: Request): Promise<AuthUser | null> {
  try {
    return await authenticate(req);
  } catch {
    // Suppress authentication errors for optional auth
    return null;
  }
}

/**
 * Check if the user has required scopes
 */
export function requireScopes(authUser: AuthUser, resource: string, action: string): void {
  if (!authUser.hasScope(resource, action)) {
    throw new Error(`Insufficient permissions for ${action} on ${resource}`);
  }
}

/**
 * Check if the user has admin access (full permissions)
 * Checks for *:* scope (full access to all resources)
 */
export function requireAdmin(authUser: AuthUser): void {
  if (!authUser.hasScope("*", "*")) {
    throw new Error("Admin access required");
  }
}

// Logging helpers
function logAuthSuccess(_method: string, _userId: string): void {
  // console.log(`[Auth] Successful ${method} authentication for user ${userId}`);
}

function logAuthFailure(method: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[Auth] Failed ${method} authentication: ${message}`);
}

import { AuthUser } from "@server/lib/auth/AuthUser";
import { authenticateBearerAuth } from "./bearerAuth";
import { authenticateApiKeyAuth } from "./apiKeyAuth";
import type { Request } from "express";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { User } from "@server/entities/user.entity";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("auth-middleware");

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
async function enhanceWithOrgContext(baseAuthUser: AuthUser, req: Request): Promise<AuthUser> {
  const organizationId = req.headers["x-organization-id"] as string | undefined;

  // If no organization header, return base AuthUser
  if (!organizationId) {
    return baseAuthUser;
  }

  // API key auth already carries organization context — the key is scoped to an org.
  // Skip UserOrganization lookup since the synthetic user has no real user record.
  if (baseAuthUser.authMethod === "apikey") {
    // Verify the requested org matches the API key's org
    if (baseAuthUser.organizationId && baseAuthUser.organizationId !== organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "API key does not belong to the specified organization",
      });
    }
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
export async function authenticate(
  req: Request,
  options: { ignoreOrganization?: boolean } = {},
): Promise<AuthUser | null> {
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

    if (options.ignoreOrganization) return baseAuthUser;

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
 * Check if the user has required scopes
 */
export function requireScopes(authUser: AuthUser, resource: string, action: string): void {
  if (!authUser.hasScope(resource, action)) {
    throw new Error(`Insufficient permissions for ${action} on ${resource}`);
  }
}

/**
 * Check that a signed-in owner or admin of the current organization is calling.
 * API tokens are never admins, whatever their scopes.
 */
export function requireAdmin(authUser: AuthUser): void {
  const role = authUser.getRole();
  if (authUser.authMethod !== "jwt" || (role !== "owner" && role !== "admin")) {
    throw new Error("Admin access required");
  }
}

// Logging helpers
function logAuthSuccess(_method: string, _userId: string): void {
  // console.log(`[Auth] Successful ${method} authentication for user ${userId}`);
}

function logAuthFailure(method: string, error: unknown): void {
  logger.error({ err: error, method }, "Authentication failed");
}

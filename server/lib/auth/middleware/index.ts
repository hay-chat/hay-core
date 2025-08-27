import { AuthUser } from '@/lib/auth/AuthUser';
import { authenticateBasicAuth } from './basicAuth';
import { authenticateBearerAuth } from './bearerAuth';
import { authenticateApiKeyAuth } from './apiKeyAuth';
import { Request } from 'express';

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
    // Try Bearer token authentication first (most common)
    if (authHeader.startsWith('Bearer ')) {
      const authUser = await authenticateBearerAuth(authHeader);
      if (authUser) {
        logAuthSuccess('jwt', authUser.id);
        return authUser;
      }
    }

    // Try Basic authentication
    if (authHeader.startsWith('Basic ')) {
      const result = await authenticateBasicAuth(authHeader);
      if (result) {
        // Store tokens in response headers for the client
        if (req.res) {
          req.res.setHeader('X-Access-Token', result.tokens.accessToken);
          req.res.setHeader('X-Refresh-Token', result.tokens.refreshToken);
          req.res.setHeader('X-Token-Expires-In', result.tokens.expiresIn.toString());
        }
        logAuthSuccess('basic', result.user.id);
        return result.user;
      }
    }

    // Try API key authentication
    if (authHeader.startsWith('ApiKey ') || 
        (authHeader.startsWith('Bearer ') && authHeader.includes('hay_'))) {
      const authUser = await authenticateApiKeyAuth(authHeader);
      if (authUser) {
        logAuthSuccess('apikey', authUser.id);
        return authUser;
      }
    }

    return null;
  } catch (error) {
    logAuthFailure(authHeader.split(' ')[0], error);
    throw error;
  }
}

/**
 * Require authentication - throws error if not authenticated
 */
export async function requireAuth(req: Request): Promise<AuthUser> {
  const authUser = await authenticate(req);
  
  if (!authUser) {
    throw new Error('Authentication required');
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
export function requireScopes(
  authUser: AuthUser,
  resource: string,
  action: string
): void {
  if (!authUser.hasScope(resource, action)) {
    throw new Error(`Insufficient permissions for ${action} on ${resource}`);
  }
}

/**
 * Check if the user is an admin
 */
export function requireAdmin(authUser: AuthUser): void {
  if (!authUser.isAdmin()) {
    throw new Error('Admin access required');
  }
}

// Logging helpers
function logAuthSuccess(method: string, userId: string): void {
  console.log(`[Auth] Successful ${method} authentication for user ${userId}`);
}

function logAuthFailure(method: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[Auth] Failed ${method} authentication: ${message}`);
}
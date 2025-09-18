import { User } from "@server/entities/user.entity";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { extractTokenFromHeader, verifyToken, isTokenExpired } from "@server/lib/auth/utils/jwt";
import type { JWTPayload } from "@server/types/auth.types";
import { AppDataSource } from "@server/database/data-source";

/**
 * Authenticate a user using Bearer Token (JWT)
 * Returns the authenticated user from the JWT payload
 */
export async function authenticateBearerAuth(authHeader?: string): Promise<AuthUser | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    throw new Error("Invalid Bearer token format");
  }

  // Check if token is expired first (quick check)
  if (isTokenExpired(token)) {
    throw new Error("Token has expired");
  }

  let payload: JWTPayload;
  try {
    // Verify and decode the token
    payload = verifyToken<JWTPayload>(token);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid token: ${error.message}`);
    }
    throw new Error("Invalid token");
  }

  // Find the user from the payload
  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({
    where: { id: payload.userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // Check if user is active
  if (!user.isActive) {
    throw new Error("Account is deactivated");
  }

  // Verify email matches (additional security check)
  if (user.email !== payload.email) {
    throw new Error("Token payload mismatch");
  }

  // Create AuthUser instance with JWT metadata
  const authUser = new AuthUser(user, "jwt", {
    sessionId: `jwt_${payload.iat}_${payload.userId}`,
  });

  return authUser;
}

/**
 * Validate a JWT token without fetching the full user
 * Used for quick authorization checks
 */
export async function validateBearerToken(authHeader?: string): Promise<JWTPayload | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    return null;
  }

  try {
    const payload = verifyToken<JWTPayload>(token);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract user ID from Bearer token without full validation
 * Used for logging and non-critical operations
 */
export function extractUserIdFromBearer(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = extractTokenFromHeader(authHeader);
  if (!token) {
    return null;
  }

  try {
    const payload = verifyToken<JWTPayload>(token);
    return payload.userId;
  } catch {
    return null;
  }
}

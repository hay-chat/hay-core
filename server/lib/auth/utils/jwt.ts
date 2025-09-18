import * as jwt from "jsonwebtoken";
import { authConfig } from "@server/config/auth.config";
import type { JWTPayload, RefreshTokenPayload, AuthTokens } from "@server/types/auth.types";
import { User } from "@server/entities/user.entity";

/**
 * Generate access and refresh tokens for a user
 */
export function generateTokens(user: User, sessionId?: string): AuthTokens {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
  };

  const signOptions: any = {
    expiresIn: authConfig.jwt.expiresIn,
    algorithm: authConfig.jwt.algorithm,
  };
  const accessToken = jwt.sign(payload, authConfig.jwt.secret, signOptions);

  const refreshPayload: RefreshTokenPayload = {
    ...payload,
    sessionId: sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2)}`,
  };

  const refreshSignOptions: any = {
    expiresIn: authConfig.jwt.refreshExpiresIn,
    algorithm: authConfig.jwt.algorithm,
  };
  const refreshToken = jwt.sign(refreshPayload, authConfig.jwt.secret, refreshSignOptions);

  // Calculate expiration time in seconds
  const expiresIn =
    typeof authConfig.jwt.expiresIn === "string"
      ? parseExpiresIn(authConfig.jwt.expiresIn)
      : authConfig.jwt.expiresIn;

  return {
    accessToken,
    refreshToken,
    expiresIn,
  };
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken<T = JWTPayload>(token: string): T {
  try {
    const decoded = jwt.verify(token, authConfig.jwt.secret, {
      algorithms: [authConfig.jwt.algorithm as jwt.Algorithm],
    }) as T;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Token has expired");
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid token");
    }
    throw error;
  }
}

/**
 * Verify a refresh token and return the payload
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return verifyToken<RefreshTokenPayload>(token);
}

/**
 * Decode a token without verifying it (useful for expired tokens)
 */
export function decodeToken<T = JWTPayload>(token: string): T | null {
  try {
    const decoded = jwt.decode(token) as T;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate a new access token from a refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const payload = verifyRefreshToken(refreshToken);

  const newPayload: JWTPayload = {
    userId: payload.userId,
    email: payload.email,
  };

  const signOptions: any = {
    expiresIn: authConfig.jwt.expiresIn,
    algorithm: authConfig.jwt.algorithm,
  };
  return jwt.sign(newPayload, authConfig.jwt.secret, signOptions);
}

/**
 * Parse expires in string to seconds
 */
function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid expiresIn format: ${expiresIn}`);
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case "s":
      return num;
    case "m":
      return num * 60;
    case "h":
      return num * 60 * 60;
    case "d":
      return num * 60 * 60 * 24;
    default:
      throw new Error(`Invalid time unit: ${unit}`);
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer") return null;

  return token;
}

/**
 * Check if a token is expired
 */
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) return true;

    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch {
    return true;
  }
}

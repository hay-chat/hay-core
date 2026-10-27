import * as jwt from "jsonwebtoken";
import { authConfig } from "@server/config/auth.config";
import type { JWTPayload, RefreshTokenPayload } from "@server/types/auth.types";
import { User } from "@server/entities/user.entity";

/** Access-token lifetime in seconds. */
export const ACCESS_TOKEN_TTL_SECONDS = parseExpiresIn(authConfig.jwt.expiresIn);

/**
 * Sign a short-lived access token. Refresh tokens are opaque and owned by
 * auth-session.service.ts.
 */
export function generateAccessToken(user: Pick<User, "id" | "email" | "tokenVersion">): string {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    type: "access",
    tokenVersion: user.tokenVersion ?? 0,
  };

  return jwt.sign(payload, authConfig.jwt.secret, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    algorithm: authConfig.jwt.algorithm,
  });
}

/**
 * Verify and decode a JWT access token
 */
export function verifyToken<T = JWTPayload>(token: string): T {
  try {
    const decoded = jwt.verify(token, authConfig.jwt.secret, {
      algorithms: [authConfig.jwt.algorithm as jwt.Algorithm],
    }) as T & Pick<JWTPayload, "type">;
    // Reject refresh tokens used as access tokens
    if (decoded.type === "refresh") {
      throw new Error("Invalid token");
    }
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
 * Verify a legacy JWT refresh token (issued before D11-3 rotation) and return
 * the payload. Uses a separate signing secret from access tokens.
 * TODO: remove with the legacy branch in auth-session.service.ts once every
 * pre-rotation refresh token has expired (30 days after the D11-3 deploy).
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, authConfig.jwt.refreshSecret, {
      algorithms: [authConfig.jwt.algorithm as jwt.Algorithm],
    }) as RefreshTokenPayload;
    // Ensure this is actually a refresh token
    if (decoded.type !== "refresh") {
      throw new Error("Invalid token");
    }
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

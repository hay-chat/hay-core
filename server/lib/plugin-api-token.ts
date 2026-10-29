/**
 * The one token a plugin worker uses to call core.
 *
 * Both plugin API surfaces (the tRPC router and the REST relay,
 * /v1/plugin-api/send-email and friends) verify it with
 * {@link verifyPluginApiToken}, so issuer, audience, scope and payload checks
 * are identical on both. Minting in one place keeps a token valid for both.
 */
import * as jwt from "jsonwebtoken";
import { config } from "@server/config/env";
import type { Organization } from "@server/entities/organization.entity";

export const PLUGIN_API_TOKEN_ISSUER = "hay-plugin-api";
export const PLUGIN_API_TOKEN_AUDIENCE = "plugin";
export const PLUGIN_API_TOKEN_SCOPE = "plugin-api";

export interface PluginApiTokenClaims {
  organizationId: string;
  pluginId: string;
  capabilities: string[];
  iat?: number;
  exp?: number;
}

/** Thrown when a token verifies cryptographically but its claims are not a plugin-api token. */
export class PluginApiTokenClaimsError extends Error {}

export function mintPluginApiToken(
  organizationId: string,
  pluginId: string,
  capabilities: string[],
): string {
  return jwt.sign(
    { organizationId, pluginId, scope: PLUGIN_API_TOKEN_SCOPE, capabilities },
    config.jwt.secret,
    {
      expiresIn: "24h",
      issuer: PLUGIN_API_TOKEN_ISSUER,
      audience: PLUGIN_API_TOKEN_AUDIENCE,
    },
  );
}

/**
 * Verify a plugin-api token: signature, expiry, issuer, audience, scope and
 * the required payload fields. Throws a `jwt` error for an invalid or expired
 * token and {@link PluginApiTokenClaimsError} for a token with the wrong claims.
 */
export function verifyPluginApiToken(token: string): PluginApiTokenClaims {
  const decoded = jwt.verify(token, config.jwt.secret, {
    issuer: PLUGIN_API_TOKEN_ISSUER,
    audience: PLUGIN_API_TOKEN_AUDIENCE,
  });
  if (typeof decoded !== "object" || decoded === null) {
    throw new PluginApiTokenClaimsError("Invalid token payload");
  }
  const claims = decoded as jwt.JwtPayload;
  if (claims.scope !== PLUGIN_API_TOKEN_SCOPE) {
    throw new PluginApiTokenClaimsError("Invalid token scope");
  }
  if (
    typeof claims.organizationId !== "string" ||
    typeof claims.pluginId !== "string" ||
    !Array.isArray(claims.capabilities) ||
    !claims.capabilities.every((capability: unknown) => typeof capability === "string")
  ) {
    throw new PluginApiTokenClaimsError("Invalid token payload");
  }
  return {
    organizationId: claims.organizationId,
    pluginId: claims.pluginId,
    capabilities: claims.capabilities,
    iat: claims.iat,
    exp: claims.exp,
  };
}

/**
 * Whether a plugin worker may act for this organization: it exists, is active
 * and is not suspended.
 */
export function isOrganizationOpenToPlugins(
  organization: Pick<Organization, "isActive" | "suspendedAt"> | null | undefined,
): boolean {
  return !!organization && organization.isActive && !organization.suspendedAt;
}

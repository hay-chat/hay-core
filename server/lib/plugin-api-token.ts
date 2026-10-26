/**
 * The one token a plugin worker uses to call core.
 *
 * Both plugin API surfaces verify it: the tRPC router checks the
 * `plugin-api` scope and the payload fields, the REST relay
 * (/v1/plugin-api/send-email and friends) checks issuer and audience.
 * Minting in one place keeps a token valid for both.
 */
import * as jwt from "jsonwebtoken";
import { config } from "@server/config/env";

export const PLUGIN_API_TOKEN_ISSUER = "hay-plugin-api";
export const PLUGIN_API_TOKEN_AUDIENCE = "plugin";
export const PLUGIN_API_TOKEN_SCOPE = "plugin-api";

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

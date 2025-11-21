import { Router } from "express";
import { getApiUrl } from "../config/env";

const router = Router();

/**
 * OAuth Client Metadata Document (CIMD)
 * https://oauth.net/2/client-id-metadata-document/
 *
 * This endpoint is used by OAuth providers that support CIMD (like Stripe MCP)
 * to dynamically discover client metadata without pre-registration.
 */
router.get("/.well-known/oauth-client", (req, res) => {
  const redirectUri = `${getApiUrl()}/oauth/callback`;

  res.json({
    client_id: redirectUri,
    client_name: "Hay",
    client_uri: "https://hay.chat",
    logo_uri: "https://hay.chat/logo.png",
    tos_uri: "https://hay.chat/terms",
    policy_uri: "https://hay.chat/privacy",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none", // CIMD uses public clients (no client_secret)
    software_id: "hay-chat",
    software_version: "1.0.0",
  });
});

export default router;

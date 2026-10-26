/**
 * The worker token must satisfy both plugin API surfaces: the REST relay
 * verifies issuer and audience, the tRPC middleware checks the scope and
 * payload fields. A token that only passes one of them breaks outbound
 * email delivery while inbound keeps working (seen in prod on 2026-10-26).
 */
import * as jwt from "jsonwebtoken";
import { config } from "@server/config/env";
import {
  mintPluginApiToken,
  PLUGIN_API_TOKEN_AUDIENCE,
  PLUGIN_API_TOKEN_ISSUER,
  PLUGIN_API_TOKEN_SCOPE,
} from "@server/lib/plugin-api-token";

describe("mintPluginApiToken", () => {
  const token = mintPluginApiToken("org-1", "hay-channel-email", ["messages", "email"]);

  it("passes the REST relay's issuer and audience check", () => {
    const decoded = jwt.verify(token, config.jwt.secret, {
      issuer: PLUGIN_API_TOKEN_ISSUER,
      audience: PLUGIN_API_TOKEN_AUDIENCE,
    }) as jwt.JwtPayload;
    expect(decoded.pluginId).toBe("hay-channel-email");
    expect(decoded.organizationId).toBe("org-1");
    expect(decoded.capabilities).toEqual(["messages", "email"]);
  });

  it("carries the scope and fields the tRPC middleware requires", () => {
    const decoded = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
    expect(decoded.scope).toBe(PLUGIN_API_TOKEN_SCOPE);
    expect(decoded.exp).toBeGreaterThan(decoded.iat as number);
  });
});

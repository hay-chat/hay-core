/**
 * The worker token must satisfy both plugin API surfaces, which share one
 * verifier (issuer, audience, scope and payload fields). A token that only
 * passes one of them breaks outbound email delivery while inbound keeps
 * working (seen in prod on 2026-10-26).
 */
import * as jwt from "jsonwebtoken";
import { config } from "@server/config/env";
import {
  isOrganizationOpenToPlugins,
  mintPluginApiToken,
  PluginApiTokenClaimsError,
  verifyPluginApiToken,
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

describe("verifyPluginApiToken", () => {
  const sign = (payload: object, options: jwt.SignOptions = {}) =>
    jwt.sign(payload, config.jwt.secret, {
      issuer: PLUGIN_API_TOKEN_ISSUER,
      audience: PLUGIN_API_TOKEN_AUDIENCE,
      ...options,
    });
  const claims = {
    scope: PLUGIN_API_TOKEN_SCOPE,
    organizationId: "org-1",
    pluginId: "hay-channel-email",
    capabilities: ["messages"],
  };

  it("accepts a minted token", () => {
    const token = mintPluginApiToken("org-1", "hay-channel-email", ["messages"]);
    expect(verifyPluginApiToken(token)).toMatchObject({
      organizationId: "org-1",
      pluginId: "hay-channel-email",
      capabilities: ["messages"],
    });
  });

  it("requires the plugin-api issuer and audience", () => {
    expect(() => verifyPluginApiToken(jwt.sign(claims, config.jwt.secret))).toThrow(
      jwt.JsonWebTokenError,
    );
    expect(() => verifyPluginApiToken(sign(claims, { audience: "dashboard" }))).toThrow(
      jwt.JsonWebTokenError,
    );
    expect(() => verifyPluginApiToken(sign(claims, { issuer: "hay" }))).toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it("requires the plugin-api scope", () => {
    expect(() => verifyPluginApiToken(sign({ ...claims, scope: "access" }))).toThrow(
      PluginApiTokenClaimsError,
    );
  });

  it("requires organization, plugin and string capabilities", () => {
    expect(() => verifyPluginApiToken(sign({ ...claims, organizationId: undefined }))).toThrow(
      PluginApiTokenClaimsError,
    );
    expect(() => verifyPluginApiToken(sign({ ...claims, pluginId: 7 }))).toThrow(
      PluginApiTokenClaimsError,
    );
    expect(() => verifyPluginApiToken(sign({ ...claims, capabilities: "messages" }))).toThrow(
      PluginApiTokenClaimsError,
    );
    expect(() => verifyPluginApiToken(sign({ ...claims, capabilities: [1] }))).toThrow(
      PluginApiTokenClaimsError,
    );
  });
});

describe("isOrganizationOpenToPlugins", () => {
  it("allows an active, unsuspended organization", () => {
    expect(isOrganizationOpenToPlugins({ isActive: true, suspendedAt: null })).toBe(true);
  });

  it("refuses a missing, inactive or suspended organization", () => {
    expect(isOrganizationOpenToPlugins(null)).toBe(false);
    expect(isOrganizationOpenToPlugins({ isActive: false, suspendedAt: null })).toBe(false);
    expect(isOrganizationOpenToPlugins({ isActive: true, suspendedAt: new Date() })).toBe(false);
  });
});

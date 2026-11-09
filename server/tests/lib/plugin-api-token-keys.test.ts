import { describe, it, expect } from "@jest/globals";
import * as jwt from "jsonwebtoken";
import { config } from "@server/config/env";
import {
  mintPluginApiToken,
  PLUGIN_API_TOKEN_AUDIENCE,
  PLUGIN_API_TOKEN_ISSUER,
  PLUGIN_API_TOKEN_SCOPE,
  verifyPluginApiToken,
} from "@server/lib/plugin-api-token";

describe("plugin API token signing key", () => {
  it("does not sign with the session secret", () => {
    const token = mintPluginApiToken("org", "plugin", []);
    expect(() => jwt.verify(token, config.jwt.secret)).toThrow("invalid signature");
    expect(verifyPluginApiToken(token).pluginId).toBe("plugin");
  });

  it("still accepts tokens issued before the key was separated", () => {
    const token = jwt.sign(
      { organizationId: "org", pluginId: "old", scope: PLUGIN_API_TOKEN_SCOPE, capabilities: [] },
      config.jwt.secret,
      { expiresIn: "1h", issuer: PLUGIN_API_TOKEN_ISSUER, audience: PLUGIN_API_TOKEN_AUDIENCE },
    );
    expect(verifyPluginApiToken(token).pluginId).toBe("old");
  });

  it("does not fall back for expired or foreign tokens", () => {
    const expired = jwt.sign({ scope: PLUGIN_API_TOKEN_SCOPE }, config.jwt.secret, {
      expiresIn: -10,
      issuer: PLUGIN_API_TOKEN_ISSUER,
      audience: PLUGIN_API_TOKEN_AUDIENCE,
    });
    expect(() => verifyPluginApiToken(expired)).toThrow("jwt expired");
    expect(() => verifyPluginApiToken(jwt.sign({}, "another-secret"))).toThrow("invalid signature");
  });
});

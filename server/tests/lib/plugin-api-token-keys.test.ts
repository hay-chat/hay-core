import { describe, it, expect, jest } from "@jest/globals";
import * as jwt from "jsonwebtoken";
import { createFakeRedisClient } from "../helpers/fake-redis";

const mockRedisClient = createFakeRedisClient();
jest.mock("@server/services/redis.service", () => ({
  redisService: { getClient: () => mockRedisClient, isConnected: () => true },
}));
import { config } from "@server/config/env";
import { deriveServiceKey } from "@server/lib/auth/utils/service-keys";
import {
  mintPluginApiToken,
  PLUGIN_API_TOKEN_AUDIENCE,
  PLUGIN_API_TOKEN_ISSUER,
  PLUGIN_API_TOKEN_SCOPE,
  verifyPluginApiToken,
} from "@server/lib/plugin-api-token";

describe("plugin API token signing key", () => {
  it("does not sign with the session secret", async () => {
    const token = mintPluginApiToken("org", "plugin", []);
    expect(() => jwt.verify(token, config.jwt.secret)).toThrow("invalid signature");
    expect((await verifyPluginApiToken(token)).pluginId).toBe("plugin");
  });

  it("refuses a token signed with the session secret", async () => {
    const token = jwt.sign(
      { organizationId: "org", pluginId: "old", scope: PLUGIN_API_TOKEN_SCOPE, capabilities: [] },
      config.jwt.secret,
      { expiresIn: "1h", issuer: PLUGIN_API_TOKEN_ISSUER, audience: PLUGIN_API_TOKEN_AUDIENCE },
    );
    await expect(verifyPluginApiToken(token)).rejects.toThrow("invalid signature");
  });

  it("rejects expired and foreign tokens", async () => {
    const expired = jwt.sign(
      { scope: PLUGIN_API_TOKEN_SCOPE },
      deriveServiceKey("hay:plugin-api-token:v1"),
      {
        expiresIn: -10,
        issuer: PLUGIN_API_TOKEN_ISSUER,
        audience: PLUGIN_API_TOKEN_AUDIENCE,
      },
    );
    await expect(verifyPluginApiToken(expired)).rejects.toThrow("jwt expired");
    await expect(verifyPluginApiToken(jwt.sign({}, "another-secret"))).rejects.toThrow(
      "invalid signature",
    );
  });
});

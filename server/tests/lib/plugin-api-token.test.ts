/**
 * The worker token must satisfy both plugin API surfaces, which share one
 * verifier (issuer, audience, scope and payload fields). A token that only
 * passes one of them breaks outbound email delivery while inbound keeps
 * working (seen in prod on 2026-10-26).
 */
import * as jwt from "jsonwebtoken";
import { createFakeRedisClient } from "../helpers/fake-redis";

const redisState: { client: ReturnType<typeof createFakeRedisClient> | null; connected: boolean } =
  {
    client: createFakeRedisClient(),
    connected: true,
  };
jest.mock("@server/services/redis.service", () => ({
  redisService: {
    getClient: () => redisState.client,
    isConnected: () => redisState.connected,
  },
}));
import { metrics } from "@server/lib/metrics";
import { deriveServiceKey } from "@server/lib/auth/utils/service-keys";
import {
  isOrganizationOpenToPlugins,
  mintPluginApiToken,
  PluginApiTokenClaimsError,
  revokePluginApiToken,
  verifyPluginApiToken,
  PLUGIN_API_TOKEN_AUDIENCE,
  PLUGIN_API_TOKEN_ISSUER,
  PLUGIN_API_TOKEN_SCOPE,
  REDIS_TIMEOUT_MS,
} from "@server/lib/plugin-api-token";

const key = deriveServiceKey("hay:plugin-api-token:v1");

describe("mintPluginApiToken", () => {
  const token = mintPluginApiToken("org-1", "hay-channel-email", ["messages", "email"]);

  it("passes the REST relay's issuer and audience check", () => {
    const decoded = jwt.verify(token, key, {
      issuer: PLUGIN_API_TOKEN_ISSUER,
      audience: PLUGIN_API_TOKEN_AUDIENCE,
    }) as jwt.JwtPayload;
    expect(decoded.pluginId).toBe("hay-channel-email");
    expect(decoded.organizationId).toBe("org-1");
    expect(decoded.capabilities).toEqual(["messages", "email"]);
  });

  it("carries the scope and fields the tRPC middleware requires", () => {
    const decoded = jwt.verify(token, key) as jwt.JwtPayload;
    expect(decoded.scope).toBe(PLUGIN_API_TOKEN_SCOPE);
    expect(decoded.exp).toBeGreaterThan(decoded.iat as number);
  });
});

describe("verifyPluginApiToken", () => {
  const sign = (payload: object, options: jwt.SignOptions = {}) =>
    jwt.sign(payload, key, {
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

  it("accepts a minted token", async () => {
    const token = mintPluginApiToken("org-1", "hay-channel-email", ["messages"]);
    await expect(verifyPluginApiToken(token)).resolves.toMatchObject({
      organizationId: "org-1",
      pluginId: "hay-channel-email",
      capabilities: ["messages"],
    });
  });

  it("requires the plugin-api issuer and audience", async () => {
    await expect(verifyPluginApiToken(jwt.sign(claims, key))).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
    await expect(verifyPluginApiToken(sign(claims, { audience: "dashboard" }))).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
    await expect(verifyPluginApiToken(sign(claims, { issuer: "hay" }))).rejects.toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it("requires the plugin-api scope", async () => {
    await expect(verifyPluginApiToken(sign({ ...claims, scope: "access" }))).rejects.toThrow(
      PluginApiTokenClaimsError,
    );
  });

  it("requires organization, plugin and string capabilities", async () => {
    const invalid = [
      { ...claims, organizationId: undefined },
      { ...claims, pluginId: 7 },
      { ...claims, capabilities: "messages" },
      { ...claims, capabilities: [1] },
    ];
    for (const payload of invalid) {
      await expect(verifyPluginApiToken(sign(payload, { jwtid: "x" }))).rejects.toThrow(
        PluginApiTokenClaimsError,
      );
    }
  });
});

describe("plugin API token lifetime", () => {
  beforeEach(() => {
    redisState.client = createFakeRedisClient();
    redisState.connected = true;
  });

  it("carries only the capabilities core recognises, once each", async () => {
    const token = mintPluginApiToken("org-1", "plugin", ["messages", "admin", "messages", "email"]);
    expect((await verifyPluginApiToken(token)).capabilities).toEqual(["messages", "email"]);
  });

  it("stops working when revoked, and only that token", async () => {
    const first = mintPluginApiToken("org-1", "plugin", ["messages"]);
    const second = mintPluginApiToken("org-1", "plugin", ["messages"]);
    await revokePluginApiToken(first);
    await expect(verifyPluginApiToken(first)).rejects.toThrow("Token is no longer active");
    expect((await verifyPluginApiToken(second)).pluginId).toBe("plugin");
  });

  it("accepts a correctly signed token that another core process minted", async () => {
    const minted = jwt.sign(
      { scope: PLUGIN_API_TOKEN_SCOPE, organizationId: "org-1", pluginId: "p", capabilities: [] },
      key,
      {
        issuer: PLUGIN_API_TOKEN_ISSUER,
        audience: PLUGIN_API_TOKEN_AUDIENCE,
        jwtid: "minted-elsewhere",
        expiresIn: 60,
      },
    );
    await expect(verifyPluginApiToken(minted)).resolves.toMatchObject({ pluginId: "p" });
  });

  it("refuses a token another core process revoked, through the shared deny-list", async () => {
    const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
    const { jti } = jwt.decode(token) as jwt.JwtPayload;
    await redisState.client!.set(`plugin-api-token:revoked:${jti}`, "1", "EX", 60);

    await expect(verifyPluginApiToken(token)).rejects.toThrow("Token is no longer active");
  });

  describe("while the deny-list cannot be read", () => {
    const labels = { surface: "plugin_api_token", action: "allowed" };

    it("accepts a token with a valid signature and expiry, and counts it", async () => {
      const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
      redisState.connected = false;
      const before = metrics.redisUnavailable.value(labels);

      await expect(verifyPluginApiToken(token)).resolves.toMatchObject({ pluginId: "plugin" });
      expect(metrics.redisUnavailable.value(labels)).toBe(before + 1);
    });

    it("accepts when there is no client", async () => {
      const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
      redisState.client = null;
      await expect(verifyPluginApiToken(token)).resolves.toMatchObject({ pluginId: "plugin" });
    });

    it("accepts when the read throws", async () => {
      const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
      redisState.client!.exists = async () => {
        throw new Error("connection reset");
      };
      await expect(verifyPluginApiToken(token)).resolves.toMatchObject({ pluginId: "plugin" });
    });

    it("still refuses a bad signature or an expired token", async () => {
      redisState.connected = false;
      const claims = {
        scope: PLUGIN_API_TOKEN_SCOPE,
        organizationId: "org-1",
        pluginId: "p",
        capabilities: [],
      };
      const options = {
        issuer: PLUGIN_API_TOKEN_ISSUER,
        audience: PLUGIN_API_TOKEN_AUDIENCE,
        jwtid: "j",
      };
      const forged = jwt.sign(claims, "another-key", { ...options, expiresIn: 60 });
      const expired = jwt.sign(claims, key, { ...options, expiresIn: -10 });
      await expect(verifyPluginApiToken(forged)).rejects.toThrow(jwt.JsonWebTokenError);
      await expect(verifyPluginApiToken(expired)).rejects.toThrow(jwt.TokenExpiredError);
    });

    it("refuses a token revoked on this process", async () => {
      const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
      redisState.connected = false;
      await revokePluginApiToken(token);
      await expect(verifyPluginApiToken(token)).rejects.toThrow("Token is no longer active");
    });

    it("does not wait past the time bound for a read that hangs", async () => {
      const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
      redisState.client!.exists = () => new Promise<number>(() => undefined);
      const started = Date.now();

      await expect(verifyPluginApiToken(token)).resolves.toMatchObject({ pluginId: "plugin" });
      expect(Date.now() - started).toBeLessThan(REDIS_TIMEOUT_MS + 500);
    });

    it("writes a revocation made during the outage once Redis is back", async () => {
      const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
      const { jti, exp } = jwt.decode(token) as jwt.JwtPayload;
      const client = redisState.client!;
      redisState.connected = false;
      await revokePluginApiToken(token);
      expect(await client.exists(`plugin-api-token:revoked:${jti}`)).toBe(0);

      redisState.connected = true;
      const other = mintPluginApiToken("org-1", "plugin", []);
      await verifyPluginApiToken(other);
      await new Promise((resolve) => setImmediate(resolve));

      expect(await client.exists(`plugin-api-token:revoked:${jti}`)).toBe(1);
      const ttl = client.ttls.get(`plugin-api-token:revoked:${jti}`) as number;
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual((exp as number) - Math.floor(Date.now() / 1000) + 1);
    });
  });

  it("writes every revocation of a batch to the shared deny-list", async () => {
    const tokens = [1, 2, 3].map(() => mintPluginApiToken("org-1", "plugin", ["messages"]));

    await Promise.all(tokens.map((token) => revokePluginApiToken(token)));

    for (const token of tokens) {
      const { jti } = jwt.decode(token) as jwt.JwtPayload;
      expect(await redisState.client!.exists(`plugin-api-token:revoked:${jti}`)).toBe(1);
    }
  });

  it("keeps a revocation made while Redis was down in force on this process", async () => {
    const token = mintPluginApiToken("org-1", "plugin", ["messages"]);
    redisState.connected = false;
    await revokePluginApiToken(token);
    redisState.connected = true;

    await expect(verifyPluginApiToken(token)).rejects.toThrow("Token is no longer active");
  });

  it("expires within a day", () => {
    const decoded = jwt.decode(mintPluginApiToken("org-1", "plugin", [])) as jwt.JwtPayload;
    expect((decoded.exp as number) - (decoded.iat as number)).toBeLessThanOrEqual(24 * 60 * 60);
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

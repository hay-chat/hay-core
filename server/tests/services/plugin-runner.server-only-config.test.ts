/**
 * Config fields flagged `serverOnly` (e.g. OAuth client secrets used by core
 * for token exchange) must never reach a plugin worker. `resolveConfigForWorker`
 * is what plugin-runner and plugin-cron feed into HAY_ORG_CONFIG / cron
 * payloads, and `stripServerOnlyFields` is what the OAuth service applies to
 * the /on-connected body.
 */
import { resolveConfigForWorker, stripServerOnlyFields } from "@server/lib/config-resolver";
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";

const schema: Record<string, ConfigFieldDescriptor> = {
  clientId: {
    type: "string",
    label: "App ID",
    env: "TEST_SERVER_ONLY_APP_ID",
  },
  clientSecret: {
    type: "string",
    label: "App Secret",
    encrypted: true,
    serverOnly: true,
    env: "TEST_SERVER_ONLY_APP_SECRET",
  },
  region: {
    type: "string",
    label: "Region",
  },
};

describe("serverOnly config fields never reach the worker", () => {
  beforeEach(() => {
    process.env.TEST_SERVER_ONLY_APP_ID = "env-app-id";
    process.env.TEST_SERVER_ONLY_APP_SECRET = "env-app-secret";
  });

  afterEach(() => {
    delete process.env.TEST_SERVER_ONLY_APP_ID;
    delete process.env.TEST_SERVER_ONLY_APP_SECRET;
  });

  it("omits env-backed serverOnly fields from the worker config", () => {
    const result = resolveConfigForWorker({}, null, schema);

    expect(result.clientId).toBe("env-app-id");
    expect(result).not.toHaveProperty("clientSecret");
    expect(JSON.stringify(result)).not.toContain("env-app-secret");
  });

  it("omits DB-stored serverOnly fields from the worker config", () => {
    const result = resolveConfigForWorker(
      { clientSecret: "db-secret", region: "eu" },
      { credentials: { accessToken: "tok" } },
      schema,
    );

    expect(result.region).toBe("eu");
    expect(result.accessToken).toBe("tok");
    expect(result).not.toHaveProperty("clientSecret");
  });

  it("stripServerOnlyFields drops only the flagged keys and keeps unknown keys", () => {
    const stripped = stripServerOnlyFields(
      { clientId: "a", clientSecret: "b", region: "eu", unknownKey: "x" },
      schema,
    );

    expect(stripped).toEqual({ clientId: "a", region: "eu", unknownKey: "x" });
  });
});

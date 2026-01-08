import {
  resolveConfigWithEnv,
  resolveConfigForWorker,
  maskConfigForLogging,
} from "../config-resolver";
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";

describe("config-resolver", () => {
  describe("resolveConfigWithEnv", () => {
    const schema: Record<string, ConfigFieldDescriptor> = {
      apiKey: {
        type: "string",
        label: "API Key",
        required: true,
        encrypted: true,
        env: "TEST_API_KEY",
      },
      clientId: {
        type: "string",
        label: "Client ID",
        required: true,
        encrypted: false,
        env: "TEST_CLIENT_ID",
      },
      endpoint: {
        type: "string",
        label: "Endpoint",
        required: false,
        default: "https://api.example.com",
      },
      customField: {
        type: "string",
        label: "Custom Field",
        required: false,
      },
    };

    beforeEach(() => {
      // Set up test environment variables
      process.env.TEST_API_KEY = "env-api-key-123";
      process.env.TEST_CLIENT_ID = "env-client-id-456";
    });

    afterEach(() => {
      // Clean up
      delete process.env.TEST_API_KEY;
      delete process.env.TEST_CLIENT_ID;
    });

    it("should use database value when present", () => {
      const dbConfig = {
        apiKey: "db-api-key-789",
        clientId: "db-client-id-012",
      };

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.apiKey).toBe("db-api-key-789");
      expect(result.values.clientId).toBe("db-client-id-012");
      expect(result.metadata.apiKey.source).toBe("database");
      expect(result.metadata.clientId.source).toBe("database");
      expect(result.metadata.apiKey.canOverride).toBe(false);
      expect(result.metadata.clientId.canOverride).toBe(false);
    });

    it("should fallback to env when DB value absent", () => {
      const dbConfig = {};

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.apiKey).toBe("env-api-key-123");
      expect(result.values.clientId).toBe("env-client-id-456");
      expect(result.metadata.apiKey.source).toBe("env");
      expect(result.metadata.clientId.source).toBe("env");
      expect(result.metadata.apiKey.canOverride).toBe(true);
      expect(result.metadata.clientId.canOverride).toBe(true);
    });

    it("should prioritize DB over env when both present", () => {
      const dbConfig = {
        apiKey: "db-api-key-789",
      };

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.apiKey).toBe("db-api-key-789");
      expect(result.metadata.apiKey.source).toBe("database");
      expect(result.values.clientId).toBe("env-client-id-456");
      expect(result.metadata.clientId.source).toBe("env");
    });

    it("should use default value when DB and env absent", () => {
      const dbConfig = {};

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.endpoint).toBe("https://api.example.com");
      expect(result.metadata.endpoint.source).toBe("default");
      expect(result.metadata.endpoint.canOverride).toBe(true);
    });

    it("should handle null DB value (user explicitly cleared)", () => {
      const dbConfig = {
        apiKey: null,
      };

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.apiKey).toBe(null);
      expect(result.metadata.apiKey.source).toBe("database");
      // Should NOT fallback to env when null is explicitly set
    });

    it("should treat empty env string as absent", () => {
      process.env.TEST_API_KEY = "";

      const dbConfig = {};
      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.apiKey).toBe(undefined);
      expect(result.metadata.apiKey.source).toBe("database");
    });

    it("should mask encrypted fields when maskSecrets is true", () => {
      const dbConfig = {
        apiKey: "db-api-key-789",
      };

      const result = resolveConfigWithEnv(dbConfig, schema, {
        decrypt: false,
        maskSecrets: true,
      });

      expect(result.values.apiKey).toBe("********");
    });

    it("should mask encrypted env-sourced values but not non-encrypted when maskSecrets is true", () => {
      const dbConfig = {};

      const result = resolveConfigWithEnv(dbConfig, schema, {
        decrypt: false,
        maskSecrets: true,
      });

      // Encrypted field should be masked
      expect(result.values.apiKey).toBe("********");
      // Non-encrypted field should be undefined (not exposed to frontend)
      expect(result.values.clientId).toBe(undefined);
      // But metadata should indicate it's from env
      expect(result.metadata.clientId.source).toBe("env");
    });

    it("should not mask non-encrypted fields", () => {
      const dbConfig = {
        clientId: "my-client-id",
      };

      const result = resolveConfigWithEnv(dbConfig, schema, {
        decrypt: false,
        maskSecrets: true,
      });

      expect(result.values.clientId).toBe("my-client-id");
    });

    it("should handle field with no value from any source", () => {
      const dbConfig = {};

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.values.customField).toBe(undefined);
      expect(result.metadata.customField.source).toBe("database");
      expect(result.metadata.customField.canOverride).toBe(true);
    });

    it("should mark encrypted fields in metadata", () => {
      const dbConfig = {};

      const result = resolveConfigWithEnv(dbConfig, schema);

      expect(result.metadata.apiKey.isEncrypted).toBe(true);
      expect(result.metadata.clientId.isEncrypted).toBe(false);
    });
  });

  describe("resolveConfigForWorker", () => {
    const schema: Record<string, ConfigFieldDescriptor> = {
      apiKey: {
        type: "string",
        label: "API Key",
        required: true,
        encrypted: true,
        env: "TEST_API_KEY",
      },
      clientId: {
        type: "string",
        label: "Client ID",
        required: true,
        encrypted: false,
        env: "TEST_CLIENT_ID",
      },
    };

    beforeEach(() => {
      process.env.TEST_API_KEY = "env-api-key-123";
      process.env.TEST_CLIENT_ID = "env-client-id-456";
    });

    afterEach(() => {
      delete process.env.TEST_API_KEY;
      delete process.env.TEST_CLIENT_ID;
    });

    it("should merge DB config with auth credentials", () => {
      const dbConfig = {
        clientId: "db-client-id",
      };
      const authState = {
        credentials: {
          apiKey: "auth-api-key",
        },
      };

      const result = resolveConfigForWorker(dbConfig, authState, schema);

      expect(result.clientId).toBe("db-client-id");
      expect(result.apiKey).toBe("auth-api-key");
    });

    it("should use env fallback for missing fields", () => {
      const dbConfig = {};
      const authState = null;

      const result = resolveConfigForWorker(dbConfig, authState, schema);

      expect(result.apiKey).toBe("env-api-key-123");
      expect(result.clientId).toBe("env-client-id-456");
    });

    it("should not mask values for worker", () => {
      const dbConfig = {
        apiKey: "db-api-key",
      };
      const authState = null;

      const result = resolveConfigForWorker(dbConfig, authState, schema);

      expect(result.apiKey).toBe("db-api-key");
      // Should return actual value, not "********"
    });

    it("should handle null authState", () => {
      const dbConfig = {
        clientId: "db-client-id",
      };

      const result = resolveConfigForWorker(dbConfig, null, schema);

      expect(result.clientId).toBe("db-client-id");
    });

    it("should handle authState without credentials", () => {
      const dbConfig = {
        clientId: "db-client-id",
      };

      const result = resolveConfigForWorker(dbConfig, {}, schema);

      expect(result.clientId).toBe("db-client-id");
    });
  });

  describe("maskConfigForLogging", () => {
    const schema: Record<string, ConfigFieldDescriptor> = {
      apiKey: {
        type: "string",
        label: "API Key",
        encrypted: true,
        env: "TEST_API_KEY",
      },
      clientId: {
        type: "string",
        label: "Client ID",
        encrypted: false,
        env: "TEST_CLIENT_ID",
      },
      endpoint: {
        type: "string",
        label: "Endpoint",
        encrypted: false,
      },
    };

    it("should mask encrypted fields", () => {
      const config = {
        apiKey: "secret-api-key",
        endpoint: "https://api.example.com",
      };

      const masked = maskConfigForLogging(config, schema);

      expect(masked.apiKey).toBe("********");
      expect(masked.endpoint).toBe("https://api.example.com");
    });

    it("should mask fields with env property", () => {
      const config = {
        clientId: "my-client-id",
        endpoint: "https://api.example.com",
      };

      const masked = maskConfigForLogging(config, schema);

      expect(masked.clientId).toBe("********");
      expect(masked.endpoint).toBe("https://api.example.com");
    });

    it("should mask both encrypted and env fields", () => {
      const config = {
        apiKey: "secret-api-key",
        clientId: "my-client-id",
        endpoint: "https://api.example.com",
      };

      const masked = maskConfigForLogging(config, schema);

      expect(masked.apiKey).toBe("********");
      expect(masked.clientId).toBe("********");
      expect(masked.endpoint).toBe("https://api.example.com");
    });

    it("should handle fields not in schema", () => {
      const config = {
        apiKey: "secret-api-key",
        unknownField: "some-value",
      };

      const masked = maskConfigForLogging(config, schema);

      expect(masked.apiKey).toBe("********");
      expect(masked.unknownField).toBe("some-value");
    });
  });
});

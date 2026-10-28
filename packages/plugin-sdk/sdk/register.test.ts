import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRegisterAPI } from "./register.js";
import { PluginRegistry } from "./registry.js";
import type { HayLogger } from "../types/index.js";

describe("Register API", () => {
  let registry: PluginRegistry;
  let logger: HayLogger;
  let registerAPI: ReturnType<typeof createRegisterAPI>;

  beforeEach(() => {
    registry = new PluginRegistry();
    logger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    registerAPI = createRegisterAPI({
      registry,
      manifest: { env: ["ALLOWED_VAR"] },
      logger,
    });
  });

  describe("Config Registration", () => {
    it("should register valid config schema", () => {
      registerAPI.config({
        apiKey: {
          type: "string",
          label: "API Key",
          required: true,
          secret: true,
        },
      });

      expect(registry.hasConfigField("apiKey")).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith("Registered config schema", { fields: 1 });
    });

    it("should register multiple config fields", () => {
      registerAPI.config({
        field1: { type: "string", label: "Field 1" },
        field2: { type: "number", label: "Field 2" },
        field3: { type: "boolean", label: "Field 3" },
      });

      expect(registry.hasConfigField("field1")).toBe(true);
      expect(registry.hasConfigField("field2")).toBe(true);
      expect(registry.hasConfigField("field3")).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith("Registered config schema", { fields: 3 });
    });

    it("should validate config schema type", () => {
      expect(() => {
        registerAPI.config(null as any);
      }).toThrow("Config schema must be an object");
    });

    it("should validate field types", () => {
      expect(() => {
        registerAPI.config({
          badField: { type: "invalid-type" as any, label: "Bad Field" },
        });
      }).toThrow("has invalid type: invalid-type");
    });

    it("should validate env var is in manifest allowlist", () => {
      expect(() => {
        registerAPI.config({
          apiKey: {
            type: "string",
            label: "API Key",
            env: "DISALLOWED_VAR",
          },
        });
      }).toThrow("not in manifest allowlist");
    });

    it("should allow env vars in manifest allowlist", () => {
      expect(() => {
        registerAPI.config({
          apiKey: {
            type: "string",
            label: "API Key",
            env: "ALLOWED_VAR",
          },
        });
      }).not.toThrow();
    });

    it("should validate default value type matches field type", () => {
      expect(() => {
        registerAPI.config({
          port: {
            type: "number",
            label: "Port",
            default: "not-a-number" as any,
          },
        });
      }).toThrow("default value has wrong type");
    });

    it("should accept valid default values", () => {
      expect(() => {
        registerAPI.config({
          name: { type: "string", label: "Name", default: "default-name" },
          port: { type: "number", label: "Port", default: 3000 },
          enabled: { type: "boolean", label: "Enabled", default: true },
          options: { type: "json", label: "Options", default: { key: "value" } },
        });
      }).not.toThrow();
    });
  });

  describe("Route Registration", () => {
    it("should register valid route", () => {
      const handler = async (req: any, res: any) => {
        res.json({ ok: true });
      };

      registerAPI.route("POST", "/webhook", handler);

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].method).toBe("POST");
      expect(routes[0].path).toBe("/webhook");
      expect(routes[0].handler).toBe(handler);
      expect(logger.debug).toHaveBeenCalledWith("Registered route", {
        method: "POST",
        path: "/webhook",
      });
    });

    it("should validate HTTP method", () => {
      expect(() => {
        registerAPI.route("INVALID" as any, "/path", async () => {});
      }).toThrow("Invalid HTTP method");
    });

    it("should accept all valid HTTP methods", () => {
      const handler = async () => {};

      expect(() => {
        registerAPI.route("GET", "/get", handler);
        registerAPI.route("POST", "/post", handler);
        registerAPI.route("PUT", "/put", handler);
        registerAPI.route("PATCH", "/patch", handler);
        registerAPI.route("DELETE", "/delete", handler);
      }).not.toThrow();

      expect(registry.getRoutes()).toHaveLength(5);
    });

    it("should validate route path starts with slash", () => {
      expect(() => {
        registerAPI.route("GET", "no-slash", async () => {});
      }).toThrow('Route path must start with "/"');
    });

    it("should validate route path is non-empty", () => {
      expect(() => {
        registerAPI.route("GET", "", async () => {});
      }).toThrow("Route path must be a non-empty string");
    });

    it("should validate handler is a function", () => {
      expect(() => {
        registerAPI.route("GET", "/path", "not-a-function" as any);
      }).toThrow("Route handler must be a function");
    });
  });

  describe("API Key Auth Registration", () => {
    beforeEach(() => {
      // Register config field first
      registerAPI.config({
        apiKey: {
          type: "string",
          label: "API Key",
          required: true,
          secret: true,
        },
      });
    });

    it("should register valid API key auth", () => {
      registerAPI.auth.apiKey({
        type: "apiKey",
        id: "api-key",
        label: "API Key",
        configField: "apiKey",
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe("api-key");
      expect(methods[0].type).toBe("apiKey");
      expect(logger.debug).toHaveBeenCalledWith("Registered API key auth method", {
        id: "api-key",
      });
    });

    it("should validate id is present", () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: "apiKey",
          id: "",
          label: "API Key",
          configField: "apiKey",
        });
      }).toThrow("API key auth id must be a non-empty string");
    });

    it("should validate label is present", () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: "apiKey",
          id: "api-key",
          label: "",
          configField: "apiKey",
        });
      }).toThrow("API key auth label must be a non-empty string");
    });

    it("should validate configField is present", () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: "apiKey",
          id: "api-key",
          label: "API Key",
          configField: "",
        });
      }).toThrow("API key auth configField must be a non-empty string");
    });

    it("should validate config field exists", () => {
      expect(() => {
        registerAPI.auth.apiKey({
          type: "apiKey",
          id: "api-key",
          label: "API Key",
          configField: "unknownField",
        });
      }).toThrow('config field "unknownField" which hasn\'t been registered');
    });
  });

  describe("OAuth2 Auth Registration", () => {
    beforeEach(() => {
      // Register config fields first
      registerAPI.config({
        clientId: { type: "string", label: "Client ID", secret: true },
        clientSecret: { type: "string", label: "Client Secret", secret: true },
      });
    });

    it("should register valid OAuth2 auth", () => {
      registerAPI.auth.oauth2({
        type: "oauth2",
        id: "oauth",
        label: "OAuth Login",
        authorizationUrl: "https://example.com/oauth/authorize",
        tokenUrl: "https://example.com/oauth/token",
        clientId: { name: "clientId" },
        clientSecret: { name: "clientSecret" },
        scopes: ["read", "write"],
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe("oauth");
      expect(methods[0].type).toBe("oauth2");
      expect(logger.debug).toHaveBeenCalledWith("Registered OAuth2 auth method", {
        id: "oauth",
      });
    });

    it("should validate id is present", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
        });
      }).toThrow("OAuth2 auth id must be a non-empty string");
    });

    it("should validate label is present", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
        });
      }).toThrow("OAuth2 auth label must be a non-empty string");
    });

    it("should validate authorizationUrl is present", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
        });
      }).toThrow("OAuth2 auth authorizationUrl must be a non-empty string");
    });

    it("should validate tokenUrl is present", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
        });
      }).toThrow("OAuth2 auth tokenUrl must be a non-empty string");
    });

    it("should validate clientId config field exists", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "unknownField" },
          clientSecret: { name: "clientSecret" },
        });
      }).toThrow('clientId references config field "unknownField" which hasn\'t been registered');
    });

    it("should validate clientSecret config field exists", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "unknownField" },
        });
      }).toThrow(
        'clientSecret references config field "unknownField" which hasn\'t been registered',
      );
    });

    it("should validate scopes is an array", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
          scopes: "not-an-array" as any,
        });
      }).toThrow("OAuth2 auth scopes must be an array");
    });

    it("should validate scopes contains only strings", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
          scopes: ["read", 123 as any, "write"],
        });
      }).toThrow("OAuth2 auth scopes must be an array of strings");
    });

    it("should allow optional scopes", () => {
      expect(() => {
        registerAPI.auth.oauth2({
          type: "oauth2",
          id: "oauth",
          label: "OAuth",
          authorizationUrl: "https://example.com/oauth/authorize",
          tokenUrl: "https://example.com/oauth/token",
          clientId: { name: "clientId" },
          clientSecret: { name: "clientSecret" },
        });
      }).not.toThrow();
    });
  });

  describe("UI Page Registration", () => {
    it("should register valid UI page", () => {
      registerAPI.ui.page({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
      });

      const pages = registry.getUIPages();
      expect(pages).toHaveLength(1);
      expect(pages[0]).toEqual({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
      });
      expect(logger.debug).toHaveBeenCalledWith("Registered UI page", {
        id: "setup-guide",
        slot: "after-settings",
      });
    });

    it("should validate id is present", () => {
      expect(() => {
        registerAPI.ui.page({ id: "", title: "Page", component: "Page.vue" });
      }).toThrow("Plugin page id must be a non-empty string");
    });

    it("should validate title is present", () => {
      expect(() => {
        registerAPI.ui.page({ id: "page", title: "", component: "Page.vue" });
      }).toThrow("Plugin page title must be a non-empty string");
    });

    it("should validate component is present", () => {
      expect(() => {
        registerAPI.ui.page({ id: "page", title: "Page", component: "" });
      }).toThrow("Plugin page component must be a non-empty string");
    });

    it("should validate slot value", () => {
      expect(() => {
        registerAPI.ui.page({
          id: "page",
          title: "Page",
          component: "Page.vue",
          slot: "sidebar" as any,
        });
      }).toThrow("Plugin page slot must be one of: standalone, after-settings, before-settings");
    });

    it("should validate optional icon and requiresSetup types", () => {
      expect(() => {
        registerAPI.ui.page({ id: "page", title: "Page", component: "Page.vue", icon: 1 as any });
      }).toThrow("Plugin page icon must be a string");

      expect(() => {
        registerAPI.ui.page({
          id: "page",
          title: "Page",
          component: "Page.vue",
          requiresSetup: "yes" as any,
        });
      }).toThrow("Plugin page requiresSetup must be a boolean");
    });

    it("should reject duplicate page ids", () => {
      registerAPI.ui.page({ id: "page", title: "Page", component: "Page.vue" });

      expect(() => {
        registerAPI.ui.page({ id: "page", title: "Other", component: "Other.vue" });
      }).toThrow('UI page with id "page" is already registered');
    });
  });

  describe("Integration Tests", () => {
    it("should enforce registration order (config before auth)", () => {
      // Try to register auth before config
      expect(() => {
        registerAPI.auth.apiKey({
          type: "apiKey",
          id: "api-key",
          label: "API Key",
          configField: "apiKey",
        });
      }).toThrow('config field "apiKey" which hasn\'t been registered');

      // Now register config
      registerAPI.config({
        apiKey: { type: "string", label: "API Key" },
      });

      // Now auth should work
      expect(() => {
        registerAPI.auth.apiKey({
          type: "apiKey",
          id: "api-key",
          label: "API Key",
          configField: "apiKey",
        });
      }).not.toThrow();
    });

    it("should allow multiple registrations of different types", () => {
      // Config
      registerAPI.config({
        apiKey: { type: "string", label: "API Key" },
      });

      // Auth
      registerAPI.auth.apiKey({
        type: "apiKey",
        id: "api-key",
        label: "API Key",
        configField: "apiKey",
      });

      // Route
      registerAPI.route("POST", "/webhook", async () => {});

      // UI
      registerAPI.ui.page({ id: "settings", title: "Settings", component: "Settings.vue" });

      // Verify all registered
      expect(registry.hasConfigField("apiKey")).toBe(true);
      expect(registry.getAuthMethods()).toHaveLength(1);
      expect(registry.getRoutes()).toHaveLength(1);
      expect(registry.getUIPages()).toHaveLength(1);
    });
  });

  describe("Webhook Routing Registration", () => {
    const routeKeyPath = { itemsPath: "data.to", keyPath: "." };

    it("accepts the svix format with the svix-signature header and an email key transform", () => {
      expect(() =>
        registerAPI.webhookRouting({
          signature: { header: "svix-signature", format: "svix", secretEnv: "ALLOWED_VAR" },
          routeKeyPath: { ...routeKeyPath, keyTransform: "email-address" },
        }),
      ).not.toThrow();
    });

    it("rejects svix with a non-svix header, unknown formats and unknown transforms", () => {
      expect(() =>
        registerAPI.webhookRouting({
          signature: { header: "x-signature", format: "svix", secretEnv: "ALLOWED_VAR" },
          routeKeyPath,
        }),
      ).toThrow(/svix-signature/);
      expect(() =>
        registerAPI.webhookRouting({
          signature: { header: "x-sig", format: "md5" as never, secretEnv: "ALLOWED_VAR" },
          routeKeyPath,
        }),
      ).toThrow(/sha256-hmac|svix/);
      expect(() =>
        registerAPI.webhookRouting({
          signature: { header: "x-sig", format: "sha256-hmac", secretEnv: "ALLOWED_VAR" },
          routeKeyPath: { ...routeKeyPath, keyTransform: "upper" as never },
        }),
      ).toThrow(/keyTransform/);
    });
  });

  describe("Cron Registration", () => {
    const handler = async () => {};

    it("should register a valid cron job and expose a descriptor (no handler)", () => {
      registerAPI.cron({
        name: "refresh_token",
        schedule: "0 */20 * * *",
        handler,
        retryPolicy: { maxRetries: 3, backoff: "exponential" },
      });

      // Full job (with handler) is retrievable by name for execution.
      const job = registry.getCronJob("refresh_token");
      expect(job).toBeDefined();
      expect(job?.handler).toBe(handler);

      // Descriptor for /metadata omits the handler.
      const descriptors = registry.getCronJobDescriptors();
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0]).toEqual({
        name: "refresh_token",
        schedule: "0 */20 * * *",
        retryPolicy: { maxRetries: 3, backoff: "exponential" },
      });
      expect("handler" in descriptors[0]).toBe(false);
    });

    it("should reject an invalid (non 5-field) schedule", () => {
      expect(() => registerAPI.cron({ name: "bad", schedule: "* * *", handler })).toThrow(
        /5-field cron expression/,
      );
    });

    it("should reject a missing handler", () => {
      expect(() =>
        registerAPI.cron({ name: "bad", schedule: "0 0 * * *", handler: undefined as any }),
      ).toThrow(/handler must be a function/);
    });

    it("should reject duplicate cron names", () => {
      registerAPI.cron({ name: "dup", schedule: "0 0 * * *", handler });
      expect(() => registerAPI.cron({ name: "dup", schedule: "0 1 * * *", handler })).toThrow(
        /already registered/,
      );
    });
  });

  describe("Webchat Registration", () => {
    beforeEach(() => {
      registerAPI.config({
        siteKey: { type: "string", label: "Site key" },
        secretKey: { type: "string", label: "Secret", encrypted: true },
      });
    });

    it("splits config references from literal props in the metadata descriptor", () => {
      registerAPI.webchat.contribution({
        id: "challenge",
        type: "challenge@1",
        props: { provider: "turnstile", siteKey: { name: "siteKey" } },
      });

      expect(registry.getWebchatMetadata().contributions).toEqual([
        {
          id: "challenge",
          type: "challenge@1",
          props: { provider: "turnstile" },
          configProps: { siteKey: "siteKey" },
        },
      ]);
    });

    it("rejects unknown contribution types", () => {
      expect(() =>
        registerAPI.webchat.contribution({
          id: "x",
          type: "script@1" as never,
          props: {},
        }),
      ).toThrow(/not supported/);
    });

    it("refuses to expose an encrypted config field as a public prop", () => {
      expect(() =>
        registerAPI.webchat.contribution({
          id: "x",
          type: "challenge@1",
          props: { secret: { name: "secretKey" } },
        }),
      ).toThrow(/encrypted/);
    });

    it("registers a gate with defaults and exposes it without the handler", () => {
      const handler = () => ({ decision: "allow" as const });
      registerAPI.webchat.gate("conversation.create", handler);

      expect(registry.getWebchatGate("conversation.create")?.handler).toBe(handler);
      expect(registry.getWebchatMetadata().gates).toEqual([
        { event: "conversation.create", timeoutMs: 3000, failurePolicy: "open" },
      ]);
    });

    it("rejects gate timeouts above the maximum and unknown events", () => {
      const handler = () => ({ decision: "allow" as const });
      expect(() =>
        registerAPI.webchat.gate("message.send", handler, { timeoutMs: 10_000 }),
      ).toThrow(/timeoutMs/);
      expect(() => registerAPI.webchat.gate("page.view" as never, handler)).toThrow(
        /not supported/,
      );
    });
  });
});

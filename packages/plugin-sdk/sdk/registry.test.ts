import { describe, it, expect, beforeEach } from "vitest";
import { PluginRegistry } from "./registry.js";
import { ConfigFieldDescriptor } from "../types/config.js";

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe("Config Schema Registration", () => {
    it("should register config schema", () => {
      const schema: Record<string, ConfigFieldDescriptor> = {
        apiKey: {
          type: "string",
          label: "API Key",
          required: true,
          secret: true,
        },
      };

      registry.registerConfig(schema);

      expect(registry.hasConfigField("apiKey")).toBe(true);
      expect(registry.getConfigField("apiKey")).toEqual(schema.apiKey);
    });

    it("should merge multiple config registrations", () => {
      registry.registerConfig({
        field1: { type: "string", label: "Field 1" },
      });

      registry.registerConfig({
        field2: { type: "number", label: "Field 2" },
      });

      expect(registry.hasConfigField("field1")).toBe(true);
      expect(registry.hasConfigField("field2")).toBe(true);
    });

    it("should overwrite config fields with same name", () => {
      registry.registerConfig({
        field1: { type: "string", label: "Original" },
      });

      registry.registerConfig({
        field1: { type: "number", label: "Updated" },
      });

      const field = registry.getConfigField("field1");
      expect(field?.label).toBe("Updated");
      expect(field?.type).toBe("number");
    });

    it("should return undefined for unknown config fields", () => {
      expect(registry.hasConfigField("unknown")).toBe(false);
      expect(registry.getConfigField("unknown")).toBeUndefined();
    });
  });

  describe("Auth Method Registration", () => {
    it("should register API Key auth method", () => {
      registry.registerAuthMethod({
        type: "apiKey",
        id: "api-key",
        label: "API Key",
        fields: {
          apiKey: {
            type: "string",
            label: "API Key",
            required: true,
            secret: true,
          },
        },
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].id).toBe("api-key");
      expect(methods[0].type).toBe("apiKey");
    });

    it("should register OAuth2 auth method", () => {
      registry.registerAuthMethod({
        type: "oauth2",
        id: "oauth",
        label: "OAuth Login",
        authorizationUrl: "https://example.com/oauth/authorize",
        tokenUrl: "https://example.com/oauth/token",
        scopes: ["read", "write"],
        clientIdEnv: "CLIENT_ID",
        clientSecretEnv: "CLIENT_SECRET",
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].type).toBe("oauth2");
    });

    it("should throw error for duplicate auth method IDs", () => {
      registry.registerAuthMethod({
        type: "apiKey",
        id: "auth-1",
        label: "Auth 1",
        fields: {},
      });

      expect(() => {
        registry.registerAuthMethod({
          type: "apiKey",
          id: "auth-1",
          label: "Auth 1 Duplicate",
          fields: {},
        });
      }).toThrow('Auth method with id "auth-1" is already registered');
    });

    it("should allow multiple auth methods with different IDs", () => {
      registry.registerAuthMethod({
        type: "apiKey",
        id: "api-key",
        label: "API Key",
        fields: {},
      });

      registry.registerAuthMethod({
        type: "oauth2",
        id: "oauth",
        label: "OAuth",
        authorizationUrl: "https://example.com/oauth/authorize",
        tokenUrl: "https://example.com/oauth/token",
        scopes: [],
        clientIdEnv: "CLIENT_ID",
        clientSecretEnv: "CLIENT_SECRET",
      });

      const methods = registry.getAuthMethods();
      expect(methods).toHaveLength(2);
    });
  });

  describe("Route Registration", () => {
    it("should register routes", () => {
      const handler = async (req: any, res: any) => {
        res.json({ ok: true });
      };

      registry.registerRoute({
        method: "POST",
        path: "/webhook",
        handler,
      });

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0].method).toBe("POST");
      expect(routes[0].path).toBe("/webhook");
      expect(routes[0].handler).toBe(handler);
    });

    it("should allow multiple routes", () => {
      registry.registerRoute({
        method: "GET",
        path: "/health",
        handler: async () => {},
      });

      registry.registerRoute({
        method: "POST",
        path: "/webhook",
        handler: async () => {},
      });

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(2);
    });

    it("should allow duplicate paths with different methods", () => {
      registry.registerRoute({
        method: "GET",
        path: "/data",
        handler: async () => {},
      });

      registry.registerRoute({
        method: "POST",
        path: "/data",
        handler: async () => {},
      });

      const routes = registry.getRoutes();
      expect(routes).toHaveLength(2);
      expect(routes[0].method).toBe("GET");
      expect(routes[1].method).toBe("POST");
    });
  });

  describe("UI Page Registration", () => {
    it("should register UI pages", () => {
      registry.registerUIPage({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
      });

      const pages = registry.getUIPages();
      expect(pages).toHaveLength(1);
      expect(pages[0].id).toBe("setup-guide");
      expect(pages[0].slot).toBe("after-settings");
    });

    it("should allow multiple UI pages", () => {
      registry.registerUIPage({ id: "page-1", title: "Page 1", component: "Page1.vue" });
      registry.registerUIPage({ id: "page-2", title: "Page 2", component: "Page2.vue" });

      expect(registry.getUIPages()).toHaveLength(2);
    });

    it("should reject duplicate page ids", () => {
      registry.registerUIPage({ id: "page", title: "Page", component: "Page.vue" });

      expect(() => {
        registry.registerUIPage({ id: "page", title: "Other", component: "Other.vue" });
      }).toThrow('UI page with id "page" is already registered');
      expect(registry.getUIPages()).toHaveLength(1);
    });

    it("should return a copy of the registered pages", () => {
      registry.registerUIPage({ id: "page", title: "Page", component: "Page.vue" });

      const pages = registry.getUIPages();
      pages.push({ id: "other", title: "Other", component: "Other.vue" });

      expect(registry.getUIPages()).toHaveLength(1);
    });
  });

  describe("Complete Registry State", () => {
    it("should maintain all registrations independently", () => {
      // Register config
      registry.registerConfig({
        apiKey: { type: "string", label: "API Key" },
      });

      // Register auth
      registry.registerAuthMethod({
        type: "apiKey",
        id: "api-key",
        label: "API Key",
        fields: {},
      });

      // Register route
      registry.registerRoute({
        method: "POST",
        path: "/webhook",
        handler: async () => {},
      });

      // Register UI
      registry.registerUIPage({ id: "settings", title: "Settings", component: "Settings.vue" });

      // Verify all are stored
      expect(registry.hasConfigField("apiKey")).toBe(true);
      expect(registry.getAuthMethods()).toHaveLength(1);
      expect(registry.getRoutes()).toHaveLength(1);
      expect(registry.getUIPages()).toHaveLength(1);
    });
  });
});

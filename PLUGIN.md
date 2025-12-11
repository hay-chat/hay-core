Got it. Let’s treat this as the **canonical spec** for the “next” Hay plugin system — no legacy, no diff, just how it works.

I’ll structure it like an internal design doc:

1. High-level model & goals
2. Plugin manifest (`package.json` -> `hay-plugin`)
3. Process & HTTP server lifecycle
4. Hook system (global vs org)
5. SDK surface (TypeScript interfaces)
6. Auth model (API key, OAuth, multiple methods, validation hook)
7. Config model (env mapping, `config.get`)
8. MCP model (local/external servers)
9. End-to-end example plugin (Stripe/Shopify-ish)

---

## 1. High-Level Model & Goals

### 1.1. Mental model

- A **plugin** is a Node package inside `/plugins/<slug>`.
- Hay discovers plugins via `package.json` and a `hay-plugin` key.
- For each **organization** that installs a plugin, Hay runs a **separate worker process** for that plugin.
- Each worker process:
  - Hosts a small **HTTP server** (internal only) for:
    - plugin-defined routes (webhooks, callbacks, etc.)
    - a standard `/metadata` endpoint (for schema + UI + MCP info)

  - Executes plugin **hooks** (lifecycle + auth + MCP boot) in-process.

So conceptually:

> `plugin` (code package) → many `plugin instances` (one per org) → each instance == one worker process + HTTP server + MCP(s).

### 1.2. Design goals

- **Security:**
  - Plugins NEVER see core env vars, DB connections, or OpenAI keys.
  - They only see env vars explicitly whitelisted in manifest.

- **Good DX:**
  - WordPress-style “hooks” and `register.*` methods.
  - Type-safe config access (`config.get("apiKey")`).

- **Multi-tenant correctness:**
  - Each org has its own plugin process (no cross-tenant leakage).

- **Flexible auth:**
  - A plugin may support multiple auth methods (e.g., API key _or_ OAuth).
  - Auth is validated via a dedicated hook.

- **MCP-first:**
  - Plugins can register and start local MCP servers.
  - Local MCP servers depend on org config and auth → initialized in a runtime hook.

---

## 2. Plugin Manifest (`package.json` → `hay-plugin`)

### 2.1. Minimal manifest structure

Each plugin’s `package.json` includes:

```jsonc
{
  "name": "hay-plugin-shopify",
  "version": "0.1.0",
  "main": "dist/index.js",

  "hay-plugin": {
    "entry": "./dist/index.js", // compiled plugin entry
    "displayName": "Shopify", // shown in marketplace
    "category": "integration", // e.g. integration | channel | tool | analytics
    "capabilities": ["routes", "mcp", "auth", "config", "ui"],
    "env": [
      "SHOPIFY_API_KEY", // env vars the plugin MAY access
      "SHOPIFY_SECRET",
    ],
  },
}
```

### 2.2. Important constraints

- Manifest is **intentionally minimal**:
  - NO config schema
  - NO MCP definitions
  - NO auth details

- `env` is an **allow-list of environment variables** the plugin may read via `config.get` (as fallback).
- If a config field references an env var that is **not** in `env`, the platform treats it as a configuration error.

---

## 3. Process & HTTP Server Lifecycle

### 3.1. Worker per org per plugin

For each `(orgId, pluginId)` pair:

- Hay spawns a **worker process**, e.g.:
  - Node process running `hay-plugin-runner.js` with:
    - plugin path
    - org id
    - allocated port

- That worker:
  1. Loads the plugin entry (`entry` from `hay-plugin`).
  2. Calls `defineHayPlugin(...)` to obtain the plugin definition.
  3. Executes the **global hook** `onInitialize`.
  4. Starts an internal HTTP server.
  5. Exposes:
     - `/metadata`
     - plugin routes registered via `register.route`

### 3.2. HTTP server responsibilities

The HTTP server inside the worker:

- Listens on a port allocated by core (e.g. `localhost:48xxx`).
- Handles:
  - `GET /metadata` → returns:
    - config schema
    - auth methods registry
    - MCP server descriptors (local / external)
    - UI extensions
    - route metadata

  - Dynamic routes registered by the plugin:
    - e.g. `POST /webhook`, `GET /health`, etc.

All calls to this server are internal (from Hay core).
Plugins are never exposed directly to the public internet by default.

### 3.3. Worker lifecycle (simplified)

1. **Start**
   - Core spawns worker process for `(org, plugin)`.
   - Plugin `onInitialize` runs.
   - HTTP server starts listening.
   - Core fetches `/metadata` and updates DB / UI.

2. **Start runtime**
   - Core loads org config + auth for this plugin instance.
   - Core calls `plugin.onStart(startCtx)`.

3. **Config update**
   - User saves plugin settings in UI.
   - Core re-validates auth via `onValidateAuth` (if provided).
   - Core restarts or re-calls `onStart` depending on implementation.
   - Plugin sees new config via `config.get`.

4. **Disable / uninstall**
   - Core calls `plugin.onDisable` (if provided).
   - Core shuts down worker process.

(See hooks section for exact semantics.)

---

## 4. Hook System

We separate hooks into:

- **Global** (static, not org-bound)
- **Org runtime** (org-bound, uses config & auth)

### 4.1. Global hook: `onInitialize`

Signature:

```ts
onInitialize?(ctx: HayGlobalContext): Promise<void> | void;
```

When:

- Called once per worker process at startup, **before** HTTP server starts.

Purpose:

- Declare **static, non-org-specific** aspects of the plugin:
  - config schema (field definitions)
  - auth methods supported (API key, OAuth…)
  - UI extensions (settings panels, etc.)
  - HTTP routes (webhooks, callbacks)

Restrictions:

- No access to org config or auth values.
- Must not perform tenant-specific work.

---

### 4.2. Org runtime hook: `onStart`

Signature:

```ts
onStart?(ctx: HayStartContext): Promise<void> | void;
```

When:

- Called whenever the plugin needs to **start or restart** for an org:
  - After initial installation + first config save.
  - After config updates (platform may restart worker and call `onStart` again).
  - After auth changes.

Purpose:

- Wire the plugin into org-specific resources:
  - Read config values (`config.get`).
  - Read auth credentials (`auth.get`).
  - Start local MCP servers.
  - Connect to external MCP servers.
  - Run lightweight initialization logic.

Behavior:

- If something fails (e.g. MCP fails to start), plugin stays **installed**, but may be marked as “degraded” (MCP offline) in UI.
- `onStart` must NOT crash the worker; errors should be logged via `logger`.

---

### 4.3. Auth validation hook: `onValidateAuth`

Signature:

```ts
onValidateAuth?(ctx: HayAuthValidationContext): Promise<boolean> | boolean;
```

When:

- Called whenever auth-related settings are saved or updated:
  - Immediately after the user configures auth (API key/OAuth) in UI.
  - Optionally before calling `onStart`.

Purpose:

- Allows plugin to verify that auth credentials are valid:
  - Test API key by calling provider endpoint.
  - Test OAuth token by calling a “me” or “ping” endpoint.

Return:

- `true` → auth is valid; UI can show “Connected”.
- `false` → auth invalid; UI shows “Auth failed”; plugin remains installed but is considered not fully configured.

If the hook is not implemented:

- Platform assumes auth is valid by default (always `true`).

---

### 4.4. Config update hook: `onConfigUpdate`

Signature:

```ts
onConfigUpdate?(ctx: HayConfigUpdateContext): Promise<void> | void;
```

When:

- Called **after** settings are saved for an org (but before or around restart/re-start of `onStart`).

Purpose:

- Optional hook if the plugin needs to be notified about config changes beyond what’s handled in `onStart`.
- Most plugins can ignore this and just react in `onStart`.

---

### 4.5. Disable hook: `onDisable`

Signature:

```ts
onDisable?(ctx: HayDisableContext): Promise<void> | void;
```

When:

- Called when the plugin is **uninstalled** or disabled for an org.

Purpose:

- Cleanup org-specific resources:
  - Revoke tokens.
  - Remove webhooks or subscriptions on external services.
  - Stop long-running jobs (if not already stopped by worker shutdown).

---

## 5. SDK Surface (TypeScript)

The plugin SDK is imported from `@hay/plugin-sdk`.

### 5.1. Top-level API: `defineHayPlugin`

```ts
import { defineHayPlugin } from "@hay/plugin-sdk";

export default defineHayPlugin((globalCtx) => {
  return <HayPluginDefinition>{
    name: "Shopify",
    onInitialize() {
      /* use globalCtx.register.* here */
    },
    async onStart(startCtx) {
      /* org runtime */
    },
    async onValidateAuth(authCtx) {
      /* validate credentials */
    },
    onConfigUpdate(configCtx) {
      /* optional */
    },
    onDisable(disableCtx) {
      /* cleanup */
    },
  };
});
```

Type:

```ts
export type HayPluginFactory = (ctx: HayGlobalContext) => HayPluginDefinition;

export interface HayPluginDefinition {
  name: string;

  onInitialize?(ctx: HayGlobalContext): void | Promise<void>;

  onStart?(ctx: HayStartContext): void | Promise<void>;

  onValidateAuth?(ctx: HayAuthValidationContext): boolean | Promise<boolean>;

  onConfigUpdate?(ctx: HayConfigUpdateContext): void | Promise<void>;

  onDisable?(ctx: HayDisableContext): void | Promise<void>;
}
```

---

### 5.2. `HayGlobalContext` (for `onInitialize`)

```ts
export interface HayGlobalContext {
  register: HayRegisterAPI;
  config: HayConfigDescriptorAPI;
  logger: HayLogger;
}
```

#### 5.2.1. `HayRegisterAPI`

```ts
export interface HayRegisterAPI {
  // HTTP routes (Express-like)
  route(method: HttpMethod, path: string, handler: RouteHandler): void;

  // Config schema definition
  config(schema: Record<string, ConfigFieldDescriptor>): void;

  // UI extensions for settings, etc.
  ui(extension: UIExtensionDescriptor): void;

  // Auth methods (API key, OAuth2, etc.)
  auth: RegisterAuthAPI;

  // (Optional) MCP descriptors if you want to expose metadata early
  mcp?: RegisterMcpDescriptorAPI;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteHandler = (req: any, res: any) => void | Promise<void>; // Express types in impl
```

#### 5.2.2. Config descriptor API (used when defining auth etc.)

```ts
export interface HayConfigDescriptorAPI {
  /**
   * Returns a reference to a config field for use in declarative places
   * (e.g., auth registration). This does NOT resolve the value.
   */
  field(name: string): ConfigFieldReference;
}

export interface ConfigFieldDescriptor<T = any> {
  type: "string" | "number" | "boolean" | "json";
  label?: string;
  description?: string;
  required?: boolean;
  env?: string; // env var name (MUST be listed in manifest `env`)
  sensitive?: boolean; // e.g. passwords, tokens
  default?: T;
}

export interface ConfigFieldReference {
  name: string;
}
```

#### 5.2.3. UI extension descriptor

```ts
export interface UIExtensionDescriptor {
  slot: string; // e.g. "after-settings", "header", etc.
  component: string; // e.g. "components/ShopifySettings.vue"
  // future: props, conditions, etc.
}
```

#### 5.2.4. Auth registration API

```ts
export interface RegisterAuthAPI {
  apiKey(options: ApiKeyAuthOptions): void;
  oauth2(options: OAuth2AuthOptions): void;
  // future: custom(), jwt(), etc.
}

export interface ApiKeyAuthOptions {
  id: string; // e.g. "apiKey"
  label: string; // shown in UI
  configField: string; // field name defined in register.config
}

export interface OAuth2AuthOptions {
  id: string; // e.g. "oauth"
  label: string; // shown in UI
  authorizationUrl: string;
  tokenUrl: string;
  scopes?: string[];

  // references to config fields that hold client id/secret, etc.
  clientId: ConfigFieldReference;
  clientSecret: ConfigFieldReference;

  // future: PKCE, redirect paths, etc.
}
```

---

### 5.3. `HayStartContext` (for `onStart`)

```ts
export interface HayStartContext {
  org: HayOrg;
  config: HayConfigRuntimeAPI;
  auth: HayAuthRuntimeAPI;
  mcp: HayMcpRuntimeAPI;
  logger: HayLogger;
}
```

#### 5.3.1. Org info

```ts
export interface HayOrg {
  id: string;
  name?: string;
  // future: region, plan, etc.
}
```

#### 5.3.2. Runtime config API

```ts
export interface HayConfigRuntimeAPI {
  /**
   * Resolves a config value for this org:
   * 1) org-specific stored setting
   * 2) if undefined, and field has `env`, and env var is whitelisted in manifest,
   *    then process.env[env] is returned
   */
  get<T = any>(key: string): T;

  getOptional<T = any>(key: string): T | undefined;

  // Optional introspection
  keys(): string[];
}
```

Resolution pipeline for `config.get("apiKey")`:

1. Look up org’s config record for field `"apiKey"`.
2. If not set, check the field descriptor defined in `register.config`:
   - if it has `env: "SHOPIFY_API_KEY"` and that name is in manifest `env`, return `process.env.SHOPIFY_API_KEY`.

3. If still missing,:
   - if required: platform may surface a configuration error in UI.
   - plugin receives `undefined` or an error depending on implementation.

#### 5.3.3. Runtime auth API

```ts
export interface HayAuthRuntimeAPI {
  /**
   * Get resolved auth info for the current org.
   * `methodId` corresponds to ids registered in RegisterAuthAPI.
   */
  get(): AuthState | null;
}

export interface AuthState {
  methodId: string; // "apiKey", "oauth", etc.
  // e.g. { apiKey: "..."} or { accessToken: "...", refreshToken: "..." }
  credentials: Record<string, unknown>;
}
```

---

#### 5.3.4. MCP runtime API (per org)

```ts
export interface HayMcpRuntimeAPI {
  /**
   * Start a local MCP server for this org.
   * `id` is an arbitrary string to identify the server instance.
   */
  startLocal(
    id: string,
    initializer: (ctx: {
      config: HayConfigRuntimeAPI;
      auth: HayAuthRuntimeAPI;
      logger: HayLogger;
    }) => Promise<McpServerInstance> | McpServerInstance,
  ): Promise<void>;

  /**
   * Connect to an external MCP server (e.g. remote URL).
   */
  startExternal(options: ExternalMcpOptions): Promise<void>;
}

export interface McpServerInstance {
  // Implementation-dependent; usually exposes a stop() method.
  stop?(): Promise<void> | void;
}

export interface ExternalMcpOptions {
  id: string; // e.g. "stripe-mcp-proxy"
  url: string; // base URL of external MCP
  authHeaders?: Record<string, string>; // derived from auth/config if needed
}
```

The platform is responsible for:

- tracking which MCP servers are running for each org+plugin
- stopping them on worker shutdown / plugin disable
- restarting them when config changes (by re-running `onStart`)

---

#### 5.3.5. Logger

```ts
export interface HayLogger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}
```

---

### 5.4. Auth validation context (`onValidateAuth`)

```ts
export interface HayAuthValidationContext {
  org: HayOrg;
  config: HayConfigRuntimeAPI;
  auth: HayAuthRuntimeAPI; // selected method + credentials
  logger: HayLogger;
}
```

---

### 5.5. Config update context (`onConfigUpdate`)

```ts
export interface HayConfigUpdateContext {
  org: HayOrg;
  config: HayConfigRuntimeAPI; // new config values
  logger: HayLogger;
}
```

---

### 5.6. Disable context (`onDisable`)

```ts
export interface HayDisableContext {
  org: HayOrg;
  logger: HayLogger;
}
```

---

## 6. Auth Model

- Plugin declares **supported auth methods** in `onInitialize` via `register.auth.*`.
- For each org, the dashboard lets the user:
  - pick a method (`apiKey`, `oauth`, …)
  - configure the corresponding fields (key, client id/secret, etc.).

- When auth settings are saved:
  - Platform builds an `AuthState` (method id + credentials).
  - Calls `onValidateAuth` (if implemented).
  - Stores validation state (valid/invalid) and shows feedback in UI.

Example `onValidateAuth`:

```ts
async onValidateAuth(ctx: HayAuthValidationContext): Promise<boolean> {
  const { methodId, credentials } = ctx.auth.get() ?? { methodId: "", credentials: {} };

  try {
    if (methodId === "apiKey") {
      const apiKey = String(credentials.apiKey || "");
      const client = new ShopifyClient({ apiKey });
      return await client.verify(); // returns boolean
    }

    if (methodId === "oauth") {
      const token = String(credentials.accessToken || "");
      const client = new ShopifyClient({ accessToken: token });
      return await client.verify();
    }

    return false;
  } catch (err) {
    ctx.logger.warn("Auth validation failed", err);
    return false;
  }
}
```

If `onValidateAuth` is not defined:

- Platform assumes auth is valid (always `true`).

---

## 7. Config Model (Including Env Mapping)

### 7.1. Declaring config fields

In `onInitialize`:

```ts
ctx.register.config({
  apiKey: {
    type: "string",
    required: false,
    env: "SHOPIFY_API_KEY", // maps to process.env.SHOPIFY_API_KEY
    sensitive: true,
  },
  clientId: {
    type: "string",
    required: false,
    env: "SHOPIFY_CLIENT_ID",
    sensitive: true,
  },
});
```

Rules:

- `env` is optional.
- If `env` is provided, it MUST be listed in manifest `hay-plugin.env`.
- UI uses schema to render settings form.

### 7.2. Reading config in runtime

In `onStart`:

```ts
const apiKey = ctx.config.get<string>("apiKey");
// If org config missing, falls back to SHOPIFY_API_KEY env if allowed+defined.
```

---

## 8. MCP Model (How Plugins Expose MCP Servers)

### 8.1. Local MCP

In `onStart`:

```ts
async onStart(ctx: HayStartContext) {
  const apiKey = ctx.config.get<string>("apiKey");

  // Start local MCP server
  await ctx.mcp.startLocal("shopify-orders", () => {
    return new ShopifyOrdersMcpServer({ apiKey, logger: ctx.logger });
  });
}
```

The `ShopifyOrdersMcpServer` is plugin-defined:

```ts
class ShopifyOrdersMcpServer implements McpServerInstance {
  constructor(opts: { apiKey: string; logger: HayLogger }) {
    // init internal client
  }

  stop() {
    // cleanup if needed
  }
}
```

The platform:

- exposes this MCP instance as part of Hay’s MCP orchestration layer.
- stops it automatically when the worker shuts down.

### 8.2. External MCP

In `onStart`:

```ts
await ctx.mcp.startExternal({
  id: "shopify-mcp-proxy",
  url: "https://mcp.myshopify-proxy.com",
  authHeaders: {
    Authorization: `Bearer ${ctx.config.get("apiKey")}`,
  },
});
```

---

## 9. Complete Example Plugin

Here’s a synthetic “Stripe” plugin that uses:

- config fields with env mapping
- API key auth
- auth validation
- start hook that boots a local MCP server and a route

```ts
// plugins/stripe/src/index.ts
import { defineHayPlugin } from "@hay/plugin-sdk";

export default defineHayPlugin((globalCtx) => ({
  name: "Stripe",

  //
  // 1) Global initialization: schema, auth, UI, routes
  //
  onInitialize() {
    const { register, config, logger } = globalCtx;

    // Config schema (org-level)
    register.config({
      apiKey: {
        type: "string",
        required: false,
        env: "STRIPE_API_KEY",
        sensitive: true,
        label: "Stripe API key",
        description: "Secret key for Stripe API.",
      },
    });

    // Auth method: API key
    register.auth.apiKey({
      id: "apiKey",
      label: "API key",
      configField: "apiKey",
    });

    // UI extension
    register.ui({
      slot: "after-settings",
      component: "components/StripeSettings.vue",
    });

    // HTTP route for Stripe webhooks
    register.route("POST", "/webhook", async (req, res) => {
      logger.info("Received Stripe webhook");
      // handle webhook payload...
      res.status(200).json({ ok: true });
    });
  },

  //
  // 2) Runtime: start for this org
  //
  async onStart(ctx) {
    const { config, auth, mcp, logger } = ctx;

    const authState = auth.get();

    if (!authState) {
      logger.warn("Stripe plugin started without auth state");
      return;
    }

    const { methodId, credentials } = authState;

    if (methodId !== "apiKey") {
      logger.warn(`Unsupported auth method: ${methodId}`);
      return;
    }

    const apiKey = String(credentials.apiKey || config.get("apiKey"));

    if (!apiKey) {
      logger.warn("No Stripe API key configured; MCP will not start.");
      return;
    }

    // Start local MCP server bound to this org’s Stripe account
    await mcp.startLocal("stripe-mcp", () => {
      return new StripeMcpServer({ apiKey, logger });
    });

    logger.info("Stripe MCP started");
  },

  //
  // 3) Auth validation
  //
  async onValidateAuth(ctx) {
    const { logger } = ctx;
    const authState = ctx.auth.get();

    if (!authState) return false;

    const { methodId, credentials } = authState;

    try {
      if (methodId === "apiKey") {
        const apiKey = String(credentials.apiKey || "");
        const client = new StripeClient(apiKey);
        const ok = await client.verify();
        if (!ok) logger.warn("Stripe API key validation failed");
        return ok;
      }

      logger.warn(`Unknown auth method for validation: ${methodId}`);
      return false;
    } catch (err) {
      logger.error("Error validating Stripe auth", err);
      return false;
    }
  },

  //
  // 4) Optional config update
  //
  onConfigUpdate(ctx) {
    ctx.logger.info("Stripe config updated; platform will restart plugin as needed.");
  },

  //
  // 5) Disable / uninstall
  //
  onDisable(ctx) {
    ctx.logger.info(`Stripe plugin disabled for org ${ctx.org.id}`);
    // Any extra cleanup if needed; MCP is stopped by platform.
  },
}));

// Example MCP server
class StripeMcpServer implements McpServerInstance {
  private client: StripeClient;
  private logger: HayLogger;

  constructor(opts: { apiKey: string; logger: HayLogger }) {
    this.client = new StripeClient(opts.apiKey);
    this.logger = opts.logger;
  }

  stop() {
    this.logger.info("Stripe MCP server stopped");
  }
}

// Stub client
class StripeClient {
  constructor(private apiKey: string) {}

  async verify(): Promise<boolean> {
    // Minimal ping to Stripe using this.apiKey
    return true;
  }
}
```

---

This is the “future”:

- Clear **manifest format**.
- Explicit **global vs org hooks**.
- Well-defined **HTTP server lifecycle**.
- Strong **auth + config + env** model.
- MCP capable and multi-tenant safe.
- A concrete TypeScript-friendly SDK that another AI (or human) can implement directly.

If you want, the next step can be: “generate the actual `@hay/plugin-sdk` TypeScript code skeleton following this spec” — but this doc should be enough to drive that implementation.

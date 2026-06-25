import { defineHayPlugin } from "@hay/plugin-sdk";
import { GraphClient } from "./graph-client.js";
import { webhookHandler } from "./webhook.js";
import { deliverHandler } from "./deliver.js";

/**
 * Instagram Channel Plugin (shared Hay Meta app)
 *
 * Connects an Instagram Professional account to Hay's orchestrator so a Hay org
 * can exchange text DMs (inbound + outbound). MVP is text-only.
 *
 * Shared-app model: a single Hay-owned Meta app serves every org. App-level
 * values come from the CORE process environment (one app for all tenants):
 *   META_APP_ID, META_APP_SECRET   — Instagram app OAuth client credentials
 *   META_VERIFY_TOKEN              — webhook GET-challenge verify token
 *
 * Per-org config is essentially empty — an org just clicks "Connect Instagram"
 * and completes the Instagram Business Login OAuth flow.
 *
 * Routing: every org's events arrive at ONE shared webhook URL with no org id.
 * The plugin DECLARES (via `register.webhookRouting`) how Core should verify the
 * shared HMAC, answer the GET handshake, and extract a routing key (the IG
 * account id) from each entry. Core resolves that key → org using the keys this
 * plugin returns from `onConnected`, then fans verified payloads out to the
 * per-org worker. Core never learns this is Instagram.
 */
export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  // State established in onStart / onConnected, accessed by route handlers and
  // lifecycle hooks via closure.
  let graphClient: GraphClient | null = null;
  let accessToken: string | null = null;

  return {
    name: "Instagram",

    onInitialize(ctx) {
      const { register, config } = ctx;

      logger.info("Initializing Instagram plugin");

      // Per-org config is empty in the shared-app model. The OAuth client
      // credentials resolve from the CORE env via the `env` fallback on these
      // hidden fields, so `register.auth.oauth2` can reference them by config
      // field name (the same mechanism whatsapp uses for env-mapped fields).
      register.config({
        clientId: {
          type: "string",
          label: "Meta App ID",
          description: "Hay-managed Meta app id (configured by the platform)",
          required: false,
          encrypted: false,
          env: "META_APP_ID",
        },
        clientSecret: {
          type: "string",
          label: "Meta App Secret",
          description: "Hay-managed Meta app secret (configured by the platform)",
          required: false,
          encrypted: true,
          env: "META_APP_SECRET",
        },
      });

      // OAuth via "Instagram API with Instagram Login" (Instagram Business
      // Login). The authorize + token endpoints live on instagram.com /
      // api.instagram.com (NOT facebook.com), no Facebook Page or config_id is
      // involved, and scopes must be COMMA-separated (declared via the generic
      // `scopeSeparator` primitive). The token exchange returns a short-lived IG
      // user token; long-lived-token exchange/refresh is a follow-up.
      register.auth.oauth2({
        id: "instagram-oauth",
        label: "Connect Instagram",
        authorizationUrl: "https://www.instagram.com/oauth/authorize",
        tokenUrl: "https://api.instagram.com/oauth/access_token",
        scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
        scopeSeparator: ",",
        clientId: config.field("clientId"),
        clientSecret: config.field("clientSecret"),
        // Instagram issues a short-lived (~1h) token. Core swaps it for a
        // long-lived (~60d) token right after connect (needs the app secret,
        // which only core has), then the platform's auto-refresh job renews it
        // via the non-standard ig_refresh_token endpoint (no refresh_token).
        tokenExchange: {
          url: "https://graph.instagram.com/access_token",
          grantType: "ig_exchange_token",
          tokenParam: "access_token",
          includeClientSecret: true,
        },
        tokenRefresh: {
          url: "https://graph.instagram.com/refresh_access_token",
          grantType: "ig_refresh_token",
          tokenParam: "access_token",
        },
      });

      // Declare how Core should route the single shared webhook. Core verifies
      // the shared HMAC once over the raw bytes (secret from META_APP_SECRET),
      // answers the GET hub.challenge handshake (verify token from
      // META_VERIFY_TOKEN), extracts the IG account id from each `entry[].id`,
      // and fans the verified per-org payload out to this worker's POST /webhook.
      register.webhookRouting({
        signature: {
          header: "x-hub-signature-256",
          format: "sha256-hmac",
          secretEnv: "META_APP_SECRET",
        },
        verificationChallenge: {
          modeParam: "hub.mode",
          verifyTokenParam: "hub.verify_token",
          challengeParam: "hub.challenge",
          verifyTokenEnv: "META_VERIFY_TOKEN",
        },
        routeKeyPath: {
          itemsPath: "entry",
          keyPath: "id",
        },
      });

      // Setup guide surfaced in plugin settings.
      register.ui.page({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
        icon: "book",
      });

      // Inbound: Core forwards verified, per-org Meta payloads here. No GET
      // route — Core answers the verification challenge itself.
      register.route("POST", "/webhook", async (req, res) => {
        await webhookHandler(req, res, {
          getGraphClient: () => graphClient,
          getAccessToken: () => accessToken,
          logger,
        });
      });

      // Outbound: ChannelDeliveryService posts here to send a bot reply.
      register.route("POST", "/deliver", async (req, res) => {
        await deliverHandler(req, res, {
          getGraphClient: () => graphClient,
          getAccessToken: () => accessToken,
          logger,
        });
      });

      logger.info("Instagram plugin config, auth, webhook routing, routes, and UI registered");
    },

    async onValidateAuth(ctx) {
      ctx.logger.info("Validating Instagram auth credentials");

      const authState = ctx.auth.get();
      if (!authState) {
        throw new Error("No authentication configured");
      }

      // OAuth: configuration is valid once saved; the access token is only
      // present after the user completes the Login for Business flow. We pass
      // either way (a real Graph check is optional and deferred).
      if (authState.credentials.accessToken) {
        ctx.logger.info("Instagram auth validation successful — access token present");
      } else {
        ctx.logger.info("Instagram auth saved — OAuth flow required to obtain an access token");
      }

      return true;
    },

    async onStart(ctx) {
      ctx.logger.info("Starting Instagram plugin", { orgId: ctx.org.id });

      const authState = ctx.auth.get();
      const token = authState?.credentials.accessToken;

      if (!token || typeof token !== "string") {
        ctx.logger.info(
          "Instagram not connected — plugin is enabled but the channel is unavailable " +
            "until the org completes the Connect Instagram OAuth flow.",
        );
        graphClient = null;
        accessToken = null;
        return;
      }

      accessToken = token;
      graphClient = new GraphClient({ logger: ctx.logger });

      // Ensure the connected account is subscribed to this app's webhooks.
      // App-level field subscription alone does not deliver messages — the
      // account must be subscribed via /me/subscribed_apps. Idempotent; failures
      // are non-fatal (logged) so a transient Graph error never crashes startup.
      void graphClient.subscribeToWebhooks(token).catch((error: unknown) => {
        ctx.logger.warn("Instagram webhook subscription failed on start", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      ctx.logger.info("Instagram plugin started", { orgId: ctx.org.id });
    },

    async onConfigUpdate(ctx) {
      // In the shared-app model the channel credential is the OAuth access token
      // (auth state), not a config field — and the config update context does
      // not expose auth. Token changes flow through onStart/onConnected (which
      // re-run on connect/restart), so there is nothing to rebuild here.
      ctx.logger.info("Instagram plugin config updated", { orgId: ctx.org.id });
    },

    async onDisable(ctx) {
      ctx.logger.info("Instagram plugin disabled", { orgId: ctx.org.id });
      graphClient = null;
      accessToken = null;
    },

    /**
     * Fired by Core immediately after OAuth tokens are stored. Resolve the IG
     * business account id(s) backing the new token and return them as opaque
     * routing keys so Core can map shared inbound webhooks (`entry[].id`) to
     * this org. Never throws — Core marks the instance degraded and reconciles
     * later rather than failing the OAuth flow.
     */
    async onConnected(ctx) {
      ctx.logger.info("Instagram onConnected — resolving routing keys", { orgId: ctx.org.id });

      const authState = ctx.auth.get();
      const token = authState?.credentials.accessToken;

      if (!token || typeof token !== "string") {
        ctx.logger.warn("Instagram onConnected — no access token available, no routing keys");
        return { routingKeys: [] };
      }

      const client = new GraphClient({ logger: ctx.logger });

      // Refresh the LIVE worker state with the freshly-minted token. onConnected
      // runs in the already-running worker after a (re)connect, but onStart —
      // which seeds the closure token used by the webhook/deliver handlers — does
      // NOT re-run on reconnect. Without this, handlers keep using the previous
      // (now stale/expired) token until the next worker restart.
      accessToken = token;
      graphClient = client;

      // Subscribe the account to this app's webhooks so inbound DMs are
      // delivered (separate from the dashboard field subscription). Non-fatal.
      try {
        await client.subscribeToWebhooks(token);
      } catch (error: unknown) {
        ctx.logger.warn("Instagram webhook subscription failed on connect", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const routingKeys = await client.getConnectedAccountIds(token);

      ctx.logger.info("Instagram onConnected — resolved routing keys", {
        orgId: ctx.org.id,
        count: routingKeys.length,
      });

      return { routingKeys };
    },
  };
});

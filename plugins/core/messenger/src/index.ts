import { defineHayPlugin } from "@hay/plugin-sdk";
import { GraphClient, type ConnectedPage } from "./graph-client.js";
import { webhookHandler } from "./webhook.js";
import { deliverHandler } from "./deliver.js";
import { SentMessageTracker } from "./echo.js";
import { PageRegistry } from "./pages.js";

/**
 * Messenger Channel Plugin (shared Hay.chat Meta app)
 *
 * Connects one or more Facebook Pages so a Hay.chat org can exchange Messenger
 * messages (text, photos, videos, voice notes, files) through the AI.
 *
 * Shared-app model, like the Instagram plugin: one Hay.chat-owned Meta app
 * serves every org, configured in the CORE environment:
 *   META_MESSENGER_APP_ID, META_MESSENGER_APP_SECRET — the Facebook app
 *   META_VERIFY_TOKEN — webhook GET-challenge verify token (shared)
 *
 * The org clicks "Connect Messenger" (Facebook Login) and picks its Pages.
 * Core stores a long-lived user token; this worker reads each Page's token
 * from /me/accounts and subscribes the Page to the app's webhooks.
 *
 * Routing: every org's events reach ONE webhook URL. `register.webhookRouting`
 * tells core how to verify the HMAC and route by `entry[].id` (the Page id),
 * using the Page ids returned from `onConnected`. Core never learns this is
 * Messenger.
 *
 * After 24 hours: Meta only allows a free-form reply within 24 hours of the
 * customer's last message. A reply written by a PERSON is resent with the
 * HUMAN_AGENT tag (allowed up to 7 days); AI replies never use it.
 */

// The fb_exchange_token call needs the app id in the URL; the worker gets it
// from the manifest env (the secret is added by core, which alone holds it).
const APP_ID_ENV = "META_MESSENGER_APP_ID";

export default defineHayPlugin((globalCtx) => {
  const { logger } = globalCtx;

  let graphClient: GraphClient | null = null;
  let appId: string | null = null;
  const pages = new PageRegistry();
  const tracker = new SentMessageTracker();

  /** Read the Pages behind `userToken` and subscribe each to the webhooks. */
  async function connectPages(client: GraphClient, userToken: string): Promise<ConnectedPage[]> {
    const connected = await pages.refresh(() => client.listPages(userToken));
    await Promise.all(
      connected.map((page) =>
        client.subscribePage(page).catch((error: unknown) => {
          logger.warn("Messenger Page webhook subscription failed", {
            pageId: page.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      ),
    );
    return connected;
  }

  return {
    name: "Messenger",

    onInitialize(ctx) {
      const { register, config } = ctx;

      register.config({
        clientId: {
          type: "string",
          label: "Meta App ID",
          description: "Hay.chat-managed Meta app id (configured by the platform)",
          required: false,
          encrypted: false,
          env: APP_ID_ENV,
        },
        clientSecret: {
          type: "string",
          label: "Meta App Secret",
          description: "Hay.chat-managed Meta app secret (configured by the platform)",
          required: false,
          encrypted: true,
          serverOnly: true,
          env: "META_MESSENGER_APP_SECRET",
        },
      });

      // Facebook Login. The code exchange returns a short-lived user token;
      // core swaps it at once for a long-lived (~60 days) one. Page tokens read
      // with a long-lived user token do not expire.
      register.auth.oauth2({
        id: "messenger-oauth",
        label: "Connect Messenger",
        authorizationUrl: "https://www.facebook.com/v21.0/dialog/oauth",
        tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
        scopes: ["pages_show_list", "pages_messaging", "pages_manage_metadata"],
        scopeSeparator: ",",
        clientId: config.field("clientId"),
        clientSecret: config.field("clientSecret"),
        tokenExchange: {
          url: `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${encodeURIComponent(
            process.env[APP_ID_ENV] ?? "",
          )}`,
          grantType: "fb_exchange_token",
          tokenParam: "fb_exchange_token",
          includeClientSecret: true,
        },
      });

      register.webhookRouting({
        signature: {
          header: "x-hub-signature-256",
          format: "sha256-hmac",
          secretEnv: "META_MESSENGER_APP_SECRET",
        },
        verificationChallenge: {
          modeParam: "hub.mode",
          verifyTokenParam: "hub.verify_token",
          challengeParam: "hub.challenge",
          verifyTokenEnv: "META_VERIFY_TOKEN",
        },
        routeKeyPath: { itemsPath: "entry", keyPath: "id" },
        // Meta's Deauthorize + Data Deletion callbacks carry the person's
        // app-scoped `user_id`, which onConnected adds to the routing keys.
        deauthorization: {
          format: "signed-request",
          param: "signed_request",
          secretEnv: "META_MESSENGER_APP_SECRET",
          keyPath: "user_id",
        },
      });

      register.ui.page({
        id: "setup-guide",
        title: "Setup Guide",
        component: "./components/settings/AfterSettings.vue",
        slot: "after-settings",
        icon: "book",
      });

      register.route("POST", "/webhook", async (req, res) => {
        await webhookHandler(req, res, {
          getGraphClient: () => graphClient,
          pages,
          logger,
          tracker,
          ownAppIds: [appId],
        });
      });

      register.route("POST", "/deliver", async (req, res) => {
        await deliverHandler(req, res, {
          getGraphClient: () => graphClient,
          pages,
          logger,
          tracker,
        });
      });
    },

    async onValidateAuth(ctx) {
      if (!ctx.auth.get()) throw new Error("No authentication configured");
      return true;
    },

    async onStart(ctx) {
      appId = ctx.config.getOptional<string>("clientId")?.trim() || null;
      const token = ctx.auth.get()?.credentials.accessToken;

      if (!token || typeof token !== "string") {
        ctx.logger.info("Messenger not connected — waiting for the Connect Messenger flow");
        graphClient = null;
        pages.clear();
        return;
      }

      const client = new GraphClient({ logger: ctx.logger });
      graphClient = client;
      // Handlers wait for the Pages; a Graph error never crashes startup.
      void connectPages(client, token).catch((error: unknown) => {
        ctx.logger.warn("Messenger Pages could not be loaded on start", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },

    async onDisable() {
      graphClient = null;
      pages.clear();
    },

    /**
     * After OAuth: load the Pages, subscribe them, and return their ids (plus
     * the person's id, for deauthorization) as routing keys. Never throws.
     */
    async onConnected(ctx) {
      const token = ctx.auth.get()?.credentials.accessToken;
      if (!token || typeof token !== "string") {
        ctx.logger.warn("Messenger onConnected — no access token, no routing keys");
        return { routingKeys: [] };
      }

      const client = new GraphClient({ logger: ctx.logger });
      graphClient = client;

      try {
        const [connected, userId] = await Promise.all([
          connectPages(client, token),
          client.getUserId(token).catch(() => null),
        ]);
        ctx.logger.info("Messenger connected", { orgId: ctx.org.id, pages: connected.length });
        const label = connected
          .map((page) => page.name)
          .filter(Boolean)
          .join(", ");
        return {
          routingKeys: [...connected.map((page) => page.id), ...(userId ? [userId] : [])],
          account: label ? { label } : undefined,
        };
      } catch (error: unknown) {
        ctx.logger.warn("Messenger onConnected — Pages could not be loaded", {
          error: error instanceof Error ? error.message : String(error),
        });
        return { routingKeys: [] };
      }
    },
  };
});

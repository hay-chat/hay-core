/**
 * Bot protection (Cloudflare Turnstile)
 *
 * Contributes a `challenge@1` to the webchat widget: the widget runs it in a
 * Hay.chat-hosted frame before the first message, and Core calls this plugin's
 * `conversation.create` gate with the token before creating the conversation.
 * The gate verifies the token with Cloudflare Siteverify, bound to the frame's
 * hostname and the `conversation_create` action.
 *
 * Keys: one Hay.chat-owned key pair from TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY.
 * Unset = the feature is unavailable (no challenge is served).
 * TODO: bring-your-own key per org (D9 research, later).
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import { EXPECTED_ACTION, decide, normalizeMode } from "./verify.js";

export default defineHayPlugin((globalCtx) => ({
  name: "Bot protection (Cloudflare Turnstile)",

  onInitialize(ctx) {
    ctx.register.config({
      mode: {
        type: "string",
        label: "Protection",
        description:
          "Invisible checks visitors in the background and only asks for a click when Cloudflare is unsure. Challenge everyone shows the check to every visitor before their first message.",
        options: [
          { label: "Off", value: "off" },
          { label: "Invisible (recommended)", value: "invisible" },
          { label: "Challenge everyone", value: "challenge_all" },
        ],
        default: "invisible",
      },
      siteKey: {
        type: "string",
        label: "Site key",
        description: "Provided by Hay.chat.",
        env: "TURNSTILE_SITE_KEY",
      },
      secretKey: {
        type: "string",
        label: "Secret key",
        description: "Provided by Hay.chat.",
        env: "TURNSTILE_SECRET_KEY",
        encrypted: true,
      },
    });

    ctx.register.webchat.contribution({
      id: "challenge",
      type: "challenge@1",
      props: {
        provider: "turnstile",
        siteKey: ctx.config.field("siteKey"),
        mode: ctx.config.field("mode"),
        action: EXPECTED_ACTION,
      },
    });

    ctx.register.webchat.gate(
      "conversation.create",
      async (gateCtx, input) => {
        const result = await decide(
          {
            siteKey: gateCtx.config.getOptional<string>("siteKey"),
            secretKey: gateCtx.config.getOptional<string>("secretKey"),
            mode: normalizeMode(gateCtx.config.getOptional<string>("mode")),
          },
          input,
        );
        if (result.decision !== "allow") {
          gateCtx.logger.info("Turnstile gate decision", {
            decision: result.decision,
            reason: result.reason,
          });
        }
        return result;
      },
      // Siteverify gets 3 s; leave headroom for the round trip to the worker.
      { timeoutMs: 4000, failurePolicy: "open" },
    );

    globalCtx.logger.info("Turnstile plugin registered");
  },
}));

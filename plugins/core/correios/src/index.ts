/**
 * Correios plugin — read-only shipment tracking for the Brazilian postal service.
 *
 * Each merchant connects their own Correios contract (there is no Hay.chat-wide
 * key): the Meu Correios user, the API access code generated in CWS (Correios
 * Web Services), and the cartão de postagem or contract number. A local Node
 * MCP server (./mcp) exchanges them for a bearer token on the Token API, caches
 * it until it expires, and calls API Rastro (SRO) for `correios_track_shipment`.
 *
 * Since the 2025 security change API Rastro only returns objects posted under
 * the caller's own contract, so a merchant can track their own parcels only.
 *
 * TODO: price and delivery-time quotes, pre-posting, reverse logistics and
 * tracking webhooks are not covered.
 *
 * @see https://www.correios.com.br/atendimento/developers
 * @see https://api.correios.com.br/token/v3/api-docs
 * @see https://api.correios.com.br/srorastro/v3/api-docs
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import {
  basicAuth,
  credentialsEnv,
  missingCredentials,
  readCredentials,
  tokenRequest,
} from "./credentials.js";

const API_HOST = "https://api.correios.com.br";

/** Correios error bodies are `{ msgs: string[] }`. */
async function correiosMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { msgs?: unknown };
    return Array.isArray(body.msgs)
      ? body.msgs
          .filter((m) => typeof m === "string")
          .join(" ")
          .slice(0, 300)
      : "";
  } catch {
    return "";
  }
}

export default defineHayPlugin((globalCtx) => ({
  name: "Correios",

  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Correios plugin");

    ctx.register.config({
      username: {
        type: "string",
        label: "Correios user",
        description:
          "The Meu Correios user of your company account (idCorreios, usually the CNPJ) that " +
          "holds the contract.",
        required: true,
      },
      accessCode: {
        type: "string",
        label: "API access code",
        description:
          'The "código de acesso" generated in CWS (cws.correios.com.br → Gestão de acesso a ' +
          "APIs). It is not your Meu Correios password.",
        required: true,
        encrypted: true,
      },
      postingCard: {
        type: "string",
        label: "Cartão de postagem",
        description:
          "The number of the cartão de postagem you post your parcels with. Enter this, the " +
          "contract number, or both.",
        placeholder: "0012345678",
      },
      contractNumber: {
        type: "string",
        label: "Contract number",
        description:
          "Your Correios contract number. Needed only when you do not enter a cartão de postagem.",
        placeholder: "9912345678",
      },
      staleTrackingDomesticDays: {
        type: "number",
        label: "Stale tracking (days)",
        description:
          "Treat a shipment as stuck when its tracking has not moved for more than this many days.",
        default: 5,
      },
    });

    ctx.register.auth.apiKey({
      id: "correios-access-code",
      label: "Correios API access code",
      configField: "accessCode",
    });
  },

  /** Connection test: the credentials are valid when Correios issues a token for them. */
  async onValidateAuth(ctx) {
    const missing = missingCredentials(ctx.config);
    if (missing) throw new Error(missing);
    const creds = readCredentials(ctx.config);
    if (!creds) throw new Error("Correios credentials are incomplete");

    const { path, body } = tokenRequest(creds);
    let res: Response;
    try {
      res = await fetch(`${API_HOST}${path}`, {
        method: "POST",
        headers: {
          Authorization: basicAuth(creds),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Could not reach Correios. Try again in a moment.");
    }
    if (res.ok) return true;

    // The Token API answers 401 (empty body) for a wrong user or access code.
    if (res.status === 401) {
      throw new Error(
        "Correios rejected the user or API access code. Generate the access code in CWS " +
          "(Gestão de acesso a APIs); it is not your Meu Correios password.",
      );
    }
    const said = await correiosMessage(res);
    if (res.status === 400 || res.status === 403) {
      throw new Error(
        "Correios refused the cartão de postagem or contract number" +
          `${said ? `: ${said}` : ""}. Check that it belongs to this user's contract.`,
      );
    }
    if (res.status === 429) {
      throw new Error("Correios is limiting requests. Wait a minute and try again.");
    }
    throw new Error(
      `Could not reach Correios (HTTP ${res.status})${said ? `: ${said}` : ""}. Try again in a moment.`,
    );
  },

  async onStart(ctx) {
    const creds = readCredentials(ctx.config);
    if (!creds) {
      ctx.logger.info("Correios: credentials not configured yet, MCP not started.");
      return;
    }
    const staleDays = ctx.config.getOptional<number | string>("staleTrackingDomesticDays");
    await ctx.mcp.startLocalStdio({
      id: "correios-mcp",
      command: "node",
      args: ["index.js"],
      cwd: "./mcp",
      env: {
        ...credentialsEnv(creds),
        ...(staleDays !== undefined && staleDays !== null && staleDays !== ""
          ? { STALE_TRACKING_DOMESTIC_DAYS: String(staleDays) }
          : {}),
      },
    });
    ctx.logger.info("Correios MCP server started", { orgId: ctx.org.id });
  },

  async onConfigUpdate(ctx) {
    // The platform restarts the stdio MCP server with fresh env after this hook.
    ctx.logger.info("Correios plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Correios plugin disabled", { orgId: ctx.org.id });
  },
}));

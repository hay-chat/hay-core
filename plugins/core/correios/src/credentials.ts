/**
 * The merchant's Correios credentials and the Token API request they map to.
 *
 * Each merchant connects their own Correios contract. The Token API takes the
 * Meu Correios user and the API access code as Basic auth, plus the cartão de
 * postagem or the contract number in the body; API Rastro is authorised by
 * contract, so one of the two is required.
 *
 * @see https://api.correios.com.br/token/v3/api-docs
 * @see https://www.correios.com.br/atendimento/developers/manuais/manual-uso-da-api-token
 */

export interface CorreiosCredentials {
  username: string;
  accessCode: string;
  postingCard?: string;
  contract?: string;
}

interface ConfigReader {
  getOptional: <T = unknown>(key: string) => T | undefined;
}

function text(config: ConfigReader, key: string): string | undefined {
  const value = config.getOptional<unknown>(key);
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value).trim() || undefined;
}

/** Why the saved settings cannot connect yet, or null when they are complete. */
export function missingCredentials(config: ConfigReader): string | null {
  if (!text(config, "username") || !text(config, "accessCode")) {
    return "Correios user and API access code are required";
  }
  if (!text(config, "postingCard") && !text(config, "contractNumber")) {
    return "Enter your cartão de postagem number or your contract number";
  }
  return null;
}

export function readCredentials(config: ConfigReader): CorreiosCredentials | null {
  if (missingCredentials(config)) return null;
  return {
    username: text(config, "username") as string,
    accessCode: text(config, "accessCode") as string,
    postingCard: text(config, "postingCard"),
    contract: text(config, "contractNumber"),
  };
}

/** Token endpoint + body: by cartão de postagem when there is one, else by contract. */
export function tokenRequest(creds: CorreiosCredentials): {
  path: string;
  body: Record<string, string>;
} {
  if (creds.postingCard) {
    return {
      path: "/token/v1/autentica/cartaopostagem",
      body: { numero: creds.postingCard, ...(creds.contract ? { contrato: creds.contract } : {}) },
    };
  }
  return { path: "/token/v1/autentica/contrato", body: { numero: creds.contract as string } };
}

export function basicAuth(creds: CorreiosCredentials): string {
  return `Basic ${Buffer.from(`${creds.username}:${creds.accessCode}`).toString("base64")}`;
}

/** MCP server env for the credentials (see mcp/lib/client.js). */
export function credentialsEnv(creds: CorreiosCredentials): Record<string, string> {
  return {
    CORREIOS_USERNAME: creds.username,
    CORREIOS_ACCESS_CODE: creds.accessCode,
    ...(creds.postingCard ? { CORREIOS_POSTING_CARD: creds.postingCard } : {}),
    ...(creds.contract ? { CORREIOS_CONTRACT: creds.contract } : {}),
  };
}

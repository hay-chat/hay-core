import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { conversationRepository } from "@server/repositories/conversation.repository";
import { dpopCacheService } from "@server/services/dpop-cache.service";

const logger = createLogger("dpop-proof");

const IAT_WINDOW_SECONDS = 120;
const MAX_JTI_LENGTH = 128;

interface EcPublicJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
}

/** What a proof must have been signed for. Always built on the server. */
export interface ProofTarget {
  method: "GET" | "POST";
  path: string;
  schemes: readonly string[];
  hosts: readonly string[];
}

export type PublicConversationProcedure =
  | "getMessages"
  | "sendMessage"
  | "sendAttachment"
  | "setContactEmail"
  | "submitCsat"
  | "rotateKeys"
  | "submitForm";

/**
 * The API's configured hostname, plus the Host the request arrived on so that
 * self-hosted setups reached under another name keep working.
 */
function acceptedHosts(requestHost: string | undefined): string[] {
  return [config.domain.api, requestHost].filter((host): host is string => Boolean(host));
}

export function publicConversationProofTarget(
  procedure: PublicConversationProcedure,
  requestHost: string | undefined,
): ProofTarget {
  return {
    method: "POST",
    path: `/v1/publicConversations.${procedure}`,
    schemes: ["http:", "https:"],
    hosts: acceptedHosts(requestHost),
  };
}

export function socketIdentifyProofTarget(requestHost: string | undefined): ProofTarget {
  return {
    method: "GET",
    path: "/ws",
    schemes: ["ws:", "wss:"],
    hosts: acceptedHosts(requestHost),
  };
}

function hostnameOf(host: string): string {
  return host.split(":")[0].toLowerCase();
}

/** The reason a proof's claims don't fit `target`, or null when they do. */
export function proofClaimsError(
  payload: Record<string, unknown>,
  target: ProofTarget,
  nowSeconds: number,
): string | null {
  if (payload.htm !== target.method) return "HTTP method mismatch";

  let htu: URL;
  try {
    htu = new URL(String(payload.htu));
  } catch {
    return "URL mismatch";
  }
  if (
    !target.schemes.includes(htu.protocol) ||
    htu.pathname !== target.path ||
    !target.hosts.some((host) => hostnameOf(host) === htu.hostname.toLowerCase())
  ) {
    return "URL mismatch";
  }

  const { iat, jti } = payload;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return "Missing issued-at time";
  if (Math.abs(nowSeconds - iat) > IAT_WINDOW_SECONDS) return "Token outside time window";
  if (typeof jti !== "string" || !jti || jti.length > MAX_JTI_LENGTH) return "Invalid JTI";

  return null;
}

/**
 * Check a webchat DPoP proof against the conversation's registered key.
 * `checkNonce: false` is for read-only attaches (the WebSocket identify) that
 * must not race the widget's HTTP calls for the single rotating nonce; jti and
 * iat still apply.
 */
export async function verifyDPoPForRequest(
  conversationId: string,
  proof: string,
  target: ProofTarget,
  options: { checkNonce?: boolean } = {},
): Promise<{ success: boolean; newNonce?: string; error?: string }> {
  try {
    // Dynamically import jose using Function constructor to avoid static analysis
    const importDynamic = new Function("specifier", "return import(specifier)");
    const jose = await importDynamic("jose");

    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      return { success: false, error: "Conversation not found" };
    }

    if (conversation.channel !== "web") {
      return { success: false, error: "Not a web conversation" };
    }

    if (!conversation.publicJwk) {
      return { success: false, error: "No public key registered" };
    }

    const payload = jose.decodeJwt(proof);
    const protectedHeader = jose.decodeProtectedHeader(proof);

    if (protectedHeader.typ !== "dpop+jwt") {
      return { success: false, error: "Invalid token type" };
    }

    if (protectedHeader.alg !== "ES256") {
      return { success: false, error: "Invalid algorithm" };
    }

    if (!protectedHeader.jwk) {
      return { success: false, error: "Missing JWK in header" };
    }

    // Compare the essential public key components (x and y for EC keys)
    const registeredJwk = conversation.publicJwk as EcPublicJwk | null;
    const receivedJwk = protectedHeader.jwk as EcPublicJwk | undefined;
    if (!receivedJwk || !registeredJwk) {
      return { success: false, error: "Missing JWK" };
    }

    if (
      receivedJwk.kty !== registeredJwk.kty ||
      receivedJwk.crv !== registeredJwk.crv ||
      receivedJwk.x !== registeredJwk.x ||
      receivedJwk.y !== registeredJwk.y
    ) {
      return { success: false, error: "Public key mismatch" };
    }

    const publicKey = await jose.importJWK(protectedHeader.jwk, "ES256");

    await jose.jwtVerify(proof, publicKey, {
      typ: "dpop+jwt",
      algorithms: ["ES256"],
    });

    const claimsError = proofClaimsError(payload, target, Math.floor(Date.now() / 1000));
    if (claimsError) {
      return { success: false, error: claimsError };
    }

    const isNewJti = await dpopCacheService.checkAndStoreJTI(payload.jti);
    if (!isNewJti) {
      return { success: false, error: "JTI already used" };
    }

    if (options.checkNonce === false) {
      return { success: true };
    }

    const newNonce = await dpopCacheService.verifyAndRotateNonce(
      conversationId,
      typeof payload.nonce === "string" ? payload.nonce : "",
    );

    if (!newNonce) {
      // Generate a new nonce for retry
      const freshNonce = await dpopCacheService.generateNonce(conversationId);
      return { success: false, error: "Invalid or expired nonce", newNonce: freshNonce };
    }

    await conversationRepository.updateById(conversationId, {
      lastMessageAt: new Date(),
    });

    return { success: true, newNonce };
  } catch (error) {
    logger.error({ err: error }, "DPoP verification error");
    return { success: false, error: "Verification failed" };
  }
}

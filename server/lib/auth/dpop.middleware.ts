import { Request, Response, NextFunction } from "express";
import { dpopCacheService } from "../../services/dpop-cache.service";
import { conversationRepository } from "../../repositories/conversation.repository";

export interface DPoPPayload {
  iat?: number;
  htm: string;
  htu: string;
  jti: string;
  nonce: string;
}

export interface DPoPVerifiedRequest extends Request {
  dpop?: {
    conversationId: string;
    publicJwk: any;
  };
}

export class DPoPError extends Error {
  constructor(
    public code: string,
    public description: string,
    public statusCode: number = 401
  ) {
    super(description);
    this.name = "DPoPError";
  }
}

/**
 * Verify DPoP proof for a conversation
 */
export async function verifyDPoPProof(
  token: string,
  conversationId: string,
  method: string,
  url: string
): Promise<{ publicJwk: any; newNonce: string }> {
  try {
    // Dynamically import jose using Function constructor to avoid static analysis
    const importDynamic = new Function('specifier', 'return import(specifier)');
    const jose = await importDynamic('jose');

    // Parse the JWT to get header and payload
    const payload = jose.decodeJwt(token) as DPoPPayload;
    const protectedHeader = jose.decodeProtectedHeader(token);

    // Verify header requirements
    if (protectedHeader.typ !== "dpop+jwt") {
      throw new DPoPError("invalid_token", "Invalid token type");
    }

    if (protectedHeader.alg !== "ES256") {
      throw new DPoPError("invalid_token", "Invalid algorithm, must be ES256");
    }

    if (!protectedHeader.jwk) {
      throw new DPoPError("invalid_token", "Missing JWK in header");
    }

    // Get the conversation to verify the public key
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new DPoPError("invalid_token", "Conversation not found", 404);
    }

    // Verify this is a web channel conversation
    if (conversation.channel !== "web") {
      throw new DPoPError("invalid_token", "DPoP authentication only supported for web channel", 403);
    }

    // Check if conversation has a registered public key
    if (!conversation.publicJwk) {
      throw new DPoPError("invalid_token", "No public key registered for this conversation", 403);
    }

    // Verify the JWK matches the registered one
    const registeredJwk = conversation.publicJwk as any;
    if (JSON.stringify(protectedHeader.jwk) !== JSON.stringify(registeredJwk)) {
      throw new DPoPError("invalid_token", "Public key does not match registered key", 403);
    }

    // Import the public key for verification
    const publicKey = await jose.importJWK(protectedHeader.jwk, "ES256");

    // Verify the JWT signature
    const { payload: verifiedPayload } = await jose.jwtVerify(token, publicKey, {
      typ: "dpop+jwt",
      algorithms: ["ES256"],
    }) as { payload: DPoPPayload };

    // Verify the claims
    if (!verifiedPayload.htm || verifiedPayload.htm !== method.toUpperCase()) {
      throw new DPoPError("invalid_token", "HTTP method mismatch");
    }

    if (!verifiedPayload.htu || !isUrlMatch(verifiedPayload.htu, url)) {
      throw new DPoPError("invalid_token", "URL mismatch");
    }

    if (!verifiedPayload.iat) {
      throw new DPoPError("invalid_token", "Missing issued-at claim");
    }

    // Check time window (±120 seconds)
    const now = Math.floor(Date.now() / 1000);
    const iat = verifiedPayload.iat;
    if (Math.abs(now - iat) > 120) {
      throw new DPoPError("invalid_token", "Token outside acceptable time window");
    }

    if (!verifiedPayload.jti) {
      throw new DPoPError("invalid_token", "Missing JTI claim");
    }

    // Check JTI for replay protection
    const isNewJti = await dpopCacheService.checkAndStoreJTI(verifiedPayload.jti);
    if (!isNewJti) {
      throw new DPoPError("invalid_token", "JTI already used (replay attack)");
    }

    if (!verifiedPayload.nonce) {
      throw new DPoPError("invalid_token", "Missing nonce claim");
    }

    // Verify and rotate nonce
    const newNonce = await dpopCacheService.verifyAndRotateNonce(
      conversationId,
      verifiedPayload.nonce
    );

    if (!newNonce) {
      throw new DPoPError("use_dpop_nonce", "Invalid or expired nonce");
    }

    // Update last message timestamp
    await conversationRepository.updateById(conversationId, {
      lastMessageAt: new Date(),
    });

    return {
      publicJwk: protectedHeader.jwk,
      newNonce,
    };
  } catch (error) {
    if (error instanceof DPoPError) {
      throw error;
    }

    if (error instanceof Error && error.message.includes('JWTVerification')) {
      throw new DPoPError("invalid_token", "Token verification failed");
    }

    console.error("DPoP verification error:", error);
    throw new DPoPError("invalid_token", "Token verification failed");
  }
}

/**
 * Express middleware for DPoP authentication
 */
export function dpopAuthMiddleware(requireAuth: boolean = true) {
  return async (req: DPoPVerifiedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract conversation ID from path
      const conversationId = req.params.conversationId || req.params.id;

      if (!conversationId) {
        if (requireAuth) {
          return res.status(400).json({
            error: "invalid_request",
            error_description: "Missing conversation ID",
          });
        }
        return next();
      }

      // Check for DPoP authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("DPoP ")) {
        if (requireAuth) {
          // Get or generate nonce for the conversation
          const nonce = await dpopCacheService.getCurrentNonce(conversationId) ||
                        await dpopCacheService.generateNonce(conversationId);

          res.setHeader("WWW-Authenticate", `DPoP error="missing_dpop_proof"`);
          res.setHeader("DPoP-Nonce", nonce);

          return res.status(401).json({
            error: "missing_dpop_proof",
            error_description: "DPoP proof required",
          });
        }
        return next();
      }

      const token = authHeader.substring(5); // Remove "DPoP " prefix

      // Construct the full URL
      const protocol = req.secure ? "https" : "http";
      const host = req.get("host") || "localhost";
      const url = `${protocol}://${host}${req.originalUrl}`;

      // Verify the DPoP proof
      const { publicJwk, newNonce } = await verifyDPoPProof(
        token,
        conversationId,
        req.method,
        url
      );

      // Set the new nonce in response header
      res.setHeader("DPoP-Nonce", newNonce);

      // Attach verified info to request
      req.dpop = {
        conversationId,
        publicJwk,
      };

      next();
    } catch (error) {
      if (error instanceof DPoPError) {
        // Generate a new nonce for retry
        const conversationId = req.params.conversationId || req.params.id;
        if (conversationId) {
          const nonce = await dpopCacheService.generateNonce(conversationId);
          res.setHeader("DPoP-Nonce", nonce);
        }

        res.setHeader(
          "WWW-Authenticate",
          `DPoP error="${error.code}", error_description="${error.description}"`
        );

        return res.status(error.statusCode).json({
          error: error.code,
          error_description: error.description,
        });
      }

      console.error("DPoP middleware error:", error);
      return res.status(500).json({
        error: "internal_error",
        error_description: "Authentication failed",
      });
    }
  };
}

/**
 * Check if two URLs match (ignoring fragments)
 */
function isUrlMatch(url1: string, url2: string): boolean {
  try {
    const parsed1 = new URL(url1);
    const parsed2 = new URL(url2);

    // Remove fragments and compare
    parsed1.hash = "";
    parsed2.hash = "";

    return parsed1.toString() === parsed2.toString();
  } catch {
    return false;
  }
}


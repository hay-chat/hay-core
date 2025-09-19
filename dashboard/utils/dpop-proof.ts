/**
 * DPoP Proof Generation for Web Embed Authentication
 * Creates and manages DPoP JWT proofs for authenticated API calls
 */

import {
  arrayBufferToBase64Url,
  stringToArrayBuffer,
  generateJTI,
  getKeypair,
} from "./dpop-crypto";

/**
 * Generate a DPoP proof JWT for a specific HTTP request
 */
export async function generateDPoPProof(
  conversationId: string,
  method: string,
  url: string,
  nonce: string
): Promise<string> {
  // Get the stored keypair for this conversation
  const keypair = await getKeypair(conversationId);
  if (!keypair) {
    throw new Error("No keypair found for conversation");
  }

  // Create the JWT header with embedded public JWK
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: keypair.publicJwk,
  };

  // Create the JWT payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    htm: method.toUpperCase(),
    htu: url,
    iat: now,
    jti: generateJTI(),
    nonce: nonce,
  };

  // Encode header and payload
  const encodedHeader = arrayBufferToBase64Url(
    stringToArrayBuffer(JSON.stringify(header))
  );
  const encodedPayload = arrayBufferToBase64Url(
    stringToArrayBuffer(JSON.stringify(payload))
  );

  // Create the signing input
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with the private key
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    keypair.privateKey,
    stringToArrayBuffer(signingInput)
  );

  // Convert ECDSA signature from DER to raw format (required for JWT)
  const rawSignature = derToRaw(new Uint8Array(signature));

  // Encode the signature
  const encodedSignature = arrayBufferToBase64Url(rawSignature);

  // Return the complete JWT
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Convert ECDSA signature from DER format to raw format
 * DER format is what WebCrypto produces, but JWT needs raw format
 */
function derToRaw(derSignature: Uint8Array): ArrayBuffer {
  // ECDSA P-256 signature is always 64 bytes in raw format (32 bytes for r, 32 bytes for s)
  const rawSignature = new Uint8Array(64);

  // Parse DER format
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;

  // Skip SEQUENCE tag (0x30)
  if (derSignature[offset++] !== 0x30) {
    throw new Error("Invalid DER signature format");
  }

  // Skip total length
  const totalLength = derSignature[offset++];
  if (totalLength & 0x80) {
    offset += totalLength & 0x7f;
  }

  // Parse r component
  if (derSignature[offset++] !== 0x02) {
    throw new Error("Invalid DER signature format (r)");
  }

  const rLength = derSignature[offset++];
  const rOffset = offset;
  offset += rLength;

  // Parse s component
  if (derSignature[offset++] !== 0x02) {
    throw new Error("Invalid DER signature format (s)");
  }

  const sLength = derSignature[offset++];
  const sOffset = offset;

  // Copy r and s to raw signature, padding with zeros if necessary
  // and skipping leading zeros if present
  let rStart = rOffset;
  let rBytes = rLength;
  if (derSignature[rStart] === 0x00) {
    rStart++;
    rBytes--;
  }

  let sStart = sOffset;
  let sBytes = sLength;
  if (derSignature[sStart] === 0x00) {
    sStart++;
    sBytes--;
  }

  // Copy r component (right-aligned in first 32 bytes)
  rawSignature.set(
    derSignature.slice(rStart, rStart + Math.min(rBytes, 32)),
    Math.max(0, 32 - rBytes)
  );

  // Copy s component (right-aligned in last 32 bytes)
  rawSignature.set(
    derSignature.slice(sStart, sStart + Math.min(sBytes, 32)),
    32 + Math.max(0, 32 - sBytes)
  );

  return rawSignature.buffer;
}

/**
 * Create a DPoP-authenticated API client for a conversation
 */
export class DPoPClient {
  private conversationId: string;
  private baseUrl: string;
  private currentNonce: string | null = null;

  constructor(conversationId: string, baseUrl: string) {
    this.conversationId = conversationId;
    this.baseUrl = baseUrl;
  }

  /**
   * Set the current nonce (usually from server response)
   */
  setNonce(nonce: string): void {
    this.currentNonce = nonce;
  }

  /**
   * Get the current nonce
   */
  getNonce(): string | null {
    return this.currentNonce;
  }

  /**
   * Make an authenticated request with DPoP proof
   */
  async request<T = any>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T; nonce: string }> {
    if (!this.currentNonce) {
      throw new Error("No nonce available. Initialize the client first.");
    }

    const url = `${this.baseUrl}${path}`;
    const method = options.method || "GET";

    // Generate DPoP proof
    const proof = await generateDPoPProof(
      this.conversationId,
      method,
      url,
      this.currentNonce
    );

    // Add DPoP authorization header
    const headers = new Headers(options.headers);
    headers.set("Authorization", `DPoP ${proof}`);

    // Make the request
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Extract new nonce from response
    const newNonce = response.headers.get("DPoP-Nonce");
    if (newNonce) {
      this.currentNonce = newNonce;
    }

    // Handle errors
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));

      // If nonce is invalid, retry once with the new nonce
      if (error.error === "use_dpop_nonce" && newNonce && newNonce !== this.currentNonce) {
        this.currentNonce = newNonce;
        return this.request(path, options);
      }

      throw new DPoPError(
        error.error || "request_failed",
        error.error_description || response.statusText,
        response.status
      );
    }

    // Parse response
    const data = await response.json();

    return {
      data,
      nonce: this.currentNonce,
    };
  }

  /**
   * Initialize the client with a fresh nonce (for new conversations)
   */
  async initialize(initialNonce?: string): Promise<void> {
    if (initialNonce) {
      this.currentNonce = initialNonce;
    } else {
      // Optionally fetch initial nonce from server
      // This would be done during conversation creation
      throw new Error("Initial nonce must be provided");
    }
  }
}

/**
 * DPoP-specific error class
 */
export class DPoPError extends Error {
  constructor(
    public code: string,
    public description: string,
    public status: number = 401
  ) {
    super(`${code}: ${description}`);
    this.name = "DPoPError";
  }
}

/**
 * Helper function to construct the full URL for tRPC endpoints
 */
export function constructTRPCUrl(baseUrl: string, procedure: string): string {
  return `${baseUrl}/v1/${procedure}`;
}

/**
 * Retry configuration for failed requests
 */
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
};

/**
 * Execute a request with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = defaultRetryConfig
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.retryDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on client errors (4xx) except for 401 (auth errors)
      if (error instanceof DPoPError) {
        if (error.status >= 400 && error.status < 500 && error.status !== 401) {
          throw error;
        }
      }

      // Don't retry on the last attempt
      if (attempt === config.maxRetries) {
        break;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= config.backoffMultiplier;
    }
  }

  throw lastError;
}
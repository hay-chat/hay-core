/**
 * DPoP proofs for the public webchat endpoints, the same shape the widget sends
 * (webchat/src/composables/useDPoP.ts): an ES256 JWT with the public JWK in the
 * header and { jti, htm, htu, iat, nonce } in the payload.
 */
import { randomBytes, webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

export interface DpopKeyPair {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

/** Only the components the server compares (kty, crv, x, y). */
function publicComponents(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function generateKeyPair(): Promise<DpopKeyPair> {
  const pair = await subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  return {
    publicJwk: publicComponents(await subtle.exportKey("jwk", pair.publicKey)),
    privateJwk: await subtle.exportKey("jwk", pair.privateKey),
  };
}

const b64url = (data: string | Uint8Array): string => Buffer.from(data).toString("base64url");

export async function createProof(
  keys: DpopKeyPair,
  method: string,
  url: string,
  nonce: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: publicComponents(keys.publicJwk) };
  const payload = {
    jti: randomBytes(16).toString("hex"),
    htm: method.toUpperCase(),
    htu: url,
    iat: Math.floor(nowMs / 1000),
    nonce,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await subtle.importKey("jwk", keys.privateJwk, ALGORITHM, false, ["sign"]);
  // WebCrypto ECDSA signatures are raw r||s, which is what JWS ES256 expects.
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

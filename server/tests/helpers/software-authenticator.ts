/**
 * A WebAuthn authenticator in software: P-256 key, "none" attestation, a
 * signature counter. It produces the JSON a browser would send back from
 * `navigator.credentials.create()` and `get()`.
 */
import * as crypto from "crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED = 0x40;

const b64url = (data: Buffer | Uint8Array): string => Buffer.from(data).toString("base64url");
const sha256 = (data: Buffer | string): Buffer => crypto.createHash("sha256").update(data).digest();

function counterBytes(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

export class SoftwareAuthenticator {
  readonly credentialId = crypto.randomBytes(32);
  /** The value the next assertion reports; an authenticator that does not count keeps it 0. */
  counter = 0;
  private readonly keys = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

  constructor(
    private readonly origin: string,
    private readonly rpId: string,
    private readonly countsSignatures = true,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  private clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private coseKey(): Uint8Array {
    const jwk = this.keys.publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
  }

  create(
    options: PublicKeyCredentialCreationOptionsJSON,
    overrides: { origin?: string } = {},
  ): RegistrationResponseJSON {
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED]),
      counterBytes(this.counter),
      Buffer.alloc(16),
      credentialIdLength,
      this.credentialId,
      this.coseKey(),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, never> | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(
          this.clientData("webauthn.create", options.challenge, overrides.origin),
        ),
        attestationObject: b64url(attestationObject),
        transports: ["usb"],
      },
    };
  }

  get(
    options: PublicKeyCredentialRequestOptionsJSON,
    overrides: { counter?: number; origin?: string } = {},
  ): AuthenticationResponseJSON {
    if (overrides.counter !== undefined) this.counter = overrides.counter;
    else if (this.countsSignatures) this.counter += 1;
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED]),
      counterBytes(this.counter),
    ]);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge, overrides.origin);
    const signature = crypto.sign(
      "sha256",
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.keys.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
    };
  }
}

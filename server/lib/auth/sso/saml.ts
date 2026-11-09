import * as crypto from "crypto";
import {
  InMemoryCacheProvider,
  SAML,
  ValidateInResponseTo,
  type CacheItem,
  type CacheProvider,
} from "@node-saml/node-saml";
import type Redis from "ioredis";
import { config, getApiUrl } from "@server/config/env";

/**
 * SAML 2.0 web browser sign-in (SP-initiated, HTTP-Redirect out, HTTP-POST back)
 * for a provider an organization owner configured.
 *
 * XML signatures, canonicalization and assertion conditions are checked by
 * @node-saml/node-saml; nothing here parses XML to decide who someone is. What
 * this module adds on top of the library: the signed assertion is required,
 * the request is tied to a single-use record in Redis, replayed assertions are
 * refused, and the Recipient the library only logs is enforced. The email
 * address comes from the signed assertion's attributes or NameID, never from
 * anywhere else in the response.
 */

const REQUEST_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_MS = 60_000;
const MAX_ASSERTION_AGE_MS = 5 * 60_000;
export const MAX_SAML_RESPONSE_CHARS = 128 * 1024;
const MAX_CERTIFICATES = 3;

const NAMEID_TRANSIENT = "urn:oasis:names:tc:SAML:2.0:nameid-format:transient";
const BEARER = "urn:oasis:names:tc:SAML:2.0:cm:bearer";

const EMAIL_ATTRIBUTES = [
  "email",
  "mail",
  "emailAddress",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "urn:oid:0.9.2342.19200300.100.1.3",
];
const GIVEN_NAME_ATTRIBUTES = [
  "givenName",
  "firstName",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  "urn:oid:2.5.4.42",
];
const FAMILY_NAME_ATTRIBUTES = [
  "sn",
  "surname",
  "lastName",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
  "urn:oid:2.5.4.4",
];

export class SamlError extends Error {
  constructor(
    public readonly code: "config_invalid" | "response_invalid" | "request_failed",
    message: string,
  ) {
    super(message);
    this.name = "SamlError";
  }
}

/**
 * The library's messages can repeat text from the response (ids, audiences, issuers), and a
 * response is supplied by whoever posts it. Only these fixed reasons reach logs and audit rows.
 */
function reasonFor(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/already been received/i.test(text)) return "The assertion was already used";
  if (/signature/i.test(text)) return "The signature could not be verified";
  if (/InResponseTo|request/i.test(text)) return "The response does not answer this sign-in";
  if (/audience/i.test(text)) return "The assertion is not meant for this service";
  if (/NotBefore|NotOnOrAfter|not yet valid|expired|valid/i.test(text)) {
    return "The assertion is not valid at this time";
  }
  if (/issuer/i.test(text)) return "The assertion comes from another issuer";
  return "The response could not be verified";
}

/** What a connection needs to talk SAML. The organization id fixes the audience, so no two organizations share one. */
export interface SamlConnectionConfig {
  organizationId: string;
  connectionId: string;
  /** The provider's entity ID (`Issuer` of its assertions). */
  idpEntityId: string;
  entryPoint: string;
  /** PEM certificate(s) the provider signs with. */
  certificate: string;
}

export interface SamlIdentity {
  nameId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  /** Values of the attribute the connection reads roles from. */
  roleValues: string[];
}

export function samlSpEntityId(organizationId: string): string {
  return `${getApiUrl()}/sso/saml/${organizationId}`;
}

export function samlAcsUrl(): string {
  return `${getApiUrl()}/sso/saml/acs`;
}

export function samlMetadataUrl(organizationId: string): string {
  return `${samlSpEntityId(organizationId)}/metadata`;
}

/** Where the browser is sent: https, or plain http only where private provider hosts are allowed on purpose. */
export function assertAcceptableSamlUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SamlError("config_invalid", "The single sign-on URL is not valid");
  }
  const allowPlain = config.sso.allowPrivateProviderHosts && url.protocol === "http:";
  if (url.protocol !== "https:" && !allowPlain) {
    throw new SamlError("config_invalid", "The single sign-on URL must use https");
  }
  if (url.username || url.password) {
    throw new SamlError("config_invalid", "The single sign-on URL must not contain credentials");
  }
  return url.toString();
}

/**
 * Accepts PEM certificates or the bare base64 some providers hand out, and
 * returns them as PEM. Expired certificates are refused; up to three may be
 * given so a provider can rotate its key without a gap.
 */
export function normalizeIdpCertificates(input: string): string {
  const blocks = input.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const bodies = blocks.length
    ? blocks.map((block) => block.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, ""))
    : [input.replace(/\s+/g, "")];
  if (bodies.length > MAX_CERTIFICATES) {
    throw new SamlError("config_invalid", `At most ${MAX_CERTIFICATES} certificates are accepted`);
  }
  const pems = bodies.map((body) => {
    let certificate: crypto.X509Certificate;
    try {
      certificate = new crypto.X509Certificate(Buffer.from(body, "base64"));
    } catch {
      throw new SamlError("config_invalid", "The certificate could not be read");
    }
    if (new Date(certificate.validTo).getTime() < Date.now()) {
      throw new SamlError("config_invalid", "The certificate has expired");
    }
    return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----`;
  });
  return pems.join("\n");
}

/**
 * Request ids and assertion ids live in Redis. A request id is spent on first
 * use; an assertion id is remembered until the assertion could no longer be
 * accepted, so a captured response cannot be played twice.
 */
export class RedisSamlCache implements CacheProvider {
  constructor(
    private readonly redis: Redis,
    private readonly scope: string,
  ) {}

  private requestKey(key: string): string {
    return `sso:saml:req:${this.scope}:${crypto.createHash("sha256").update(key).digest("hex")}`;
  }

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    await this.redis.set(this.requestKey(key), value, "EX", REQUEST_TTL_SECONDS);
    return { value, createdAt: Date.now() };
  }

  async getAsync(key: string): Promise<string | null> {
    return this.redis.get(this.requestKey(key));
  }

  async removeAsync(key: string | null): Promise<string | null> {
    return key === null ? null : this.redis.getdel(this.requestKey(key));
  }

  async consumeAsync(key: string): Promise<string | null> {
    return this.redis.getdel(this.requestKey(key));
  }

  async saveIfAbsentAsync(key: string, value: string, expiresAtMs: number): Promise<boolean> {
    const digest = crypto.createHash("sha256").update(key).digest("hex");
    const stored = await this.redis.set(
      `sso:saml:assertion:${this.scope}:${digest}`,
      value,
      "PXAT",
      Math.ceil(expiresAtMs),
      "NX",
    );
    return stored === "OK";
  }
}

function samlFor(connection: SamlConnectionConfig, cache: CacheProvider, requestId?: string) {
  const entityId = samlSpEntityId(connection.organizationId);
  return new SAML({
    callbackUrl: samlAcsUrl(),
    entryPoint: connection.entryPoint,
    issuer: entityId,
    audience: entityId,
    idpIssuer: connection.idpEntityId,
    idpCert: connection.certificate.split(/(?<=-----END CERTIFICATE-----)\n/),
    // The assertion itself must carry a valid signature from the configured certificate.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_TTL_SECONDS * 1000,
    rejectReplayedAssertions: true,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    disableRequestedAuthnContext: true,
    cacheProvider: cache,
    ...(requestId ? { generateUniqueId: () => requestId } : {}),
  });
}

export function newSamlRequestId(): string {
  // An XML ID must not start with a digit.
  return `_${crypto.randomBytes(20).toString("hex")}`;
}

/** The redirect to the provider. `requestId` is what the response must answer. */
export async function buildSamlRedirect(
  connection: SamlConnectionConfig,
  cache: CacheProvider,
  requestId: string,
  relayState: string,
): Promise<string> {
  try {
    return await samlFor(connection, cache, requestId).getAuthorizeUrlAsync(
      relayState,
      undefined,
      {},
    );
  } catch (error) {
    throw new SamlError("request_failed", "The sign-in request could not be built");
  }
}

export function samlServiceProviderMetadata(connection: SamlConnectionConfig): string {
  const saml = samlFor(connection, new InMemoryCacheProvider());
  return saml.generateServiceProviderMetadata(null, null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(attributes: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(attributes, name)) continue;
    const value = attributes[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return asList(value).filter((item): item is string => typeof item === "string");
}

/**
 * Every bearer confirmation in the signed assertion must be addressed to this
 * ACS URL and answer this request. The library only logs the Recipient.
 */
function assertBearerConfirmations(assertion: Record<string, unknown>, requestId: string): void {
  const subject = asRecord(asList(assertion.Subject)[0]);
  const confirmations = asList(subject?.SubjectConfirmation).map(asRecord);
  const bearers = confirmations.filter((c) => asRecord(c?.$)?.Method === BEARER);
  if (bearers.length === 0) {
    throw new SamlError("response_invalid", "The assertion has no bearer confirmation");
  }
  for (const confirmation of bearers) {
    const data = asRecord(asList(confirmation?.SubjectConfirmationData)[0]);
    const attributes = asRecord(data?.$);
    if (attributes?.Recipient !== samlAcsUrl()) {
      throw new SamlError("response_invalid", "The assertion was not addressed to this endpoint");
    }
    if (attributes?.InResponseTo !== undefined && attributes.InResponseTo !== requestId) {
      throw new SamlError("response_invalid", "The assertion answers a different request");
    }
  }
}

/**
 * Validates a POSTed SAML response against the one request it must answer and
 * returns who the signed assertion describes.
 */
export async function validateSamlResponse(
  connection: SamlConnectionConfig,
  cache: CacheProvider,
  input: { samlResponse: string; requestId: string; roleAttribute?: string | null },
): Promise<SamlIdentity> {
  if (!input.samlResponse || input.samlResponse.length > MAX_SAML_RESPONSE_CHARS) {
    throw new SamlError("response_invalid", "The response is empty or too large");
  }
  let profile;
  try {
    const result = await samlFor(connection, cache).validatePostResponseAsync({
      SAMLResponse: input.samlResponse,
    });
    profile = result.profile;
  } catch (error) {
    throw new SamlError("response_invalid", reasonFor(error));
  }
  if (!profile || !profile.getAssertion || !profile.getAssertionXml) {
    throw new SamlError("response_invalid", "The response carries no assertion");
  }
  if (profile.inResponseTo !== input.requestId) {
    throw new SamlError("response_invalid", "The response answers a different request");
  }
  // A comment can split a name so that a parser keeps only part of what was signed.
  if (profile.getAssertionXml().includes("<!--")) {
    throw new SamlError("response_invalid", "The assertion contains comments");
  }
  const assertion = asRecord(asRecord(profile.getAssertion())?.Assertion);
  if (!assertion) throw new SamlError("response_invalid", "The assertion could not be read");
  assertBearerConfirmations(assertion, input.requestId);

  const nameId = profile.nameID;
  if (
    typeof nameId !== "string" ||
    !nameId.trim() ||
    nameId.length > 255 ||
    nameId !== nameId.trim()
  ) {
    throw new SamlError("response_invalid", "The assertion has no usable NameID");
  }
  if (profile.nameIDFormat === NAMEID_TRANSIENT) {
    throw new SamlError(
      "response_invalid",
      "A transient NameID cannot identify a returning person",
    );
  }

  const attributes = asRecord(profile.attributes) ?? {};
  const email =
    firstString(attributes, EMAIL_ATTRIBUTES) ?? (nameId.includes("@") ? nameId : undefined);
  if (!email) throw new SamlError("response_invalid", "The assertion has no email address");

  return {
    nameId,
    email,
    firstName: firstString(attributes, GIVEN_NAME_ATTRIBUTES),
    lastName: firstString(attributes, FAMILY_NAME_ATTRIBUTES),
    roleValues:
      input.roleAttribute && Object.prototype.hasOwnProperty.call(attributes, input.roleAttribute)
        ? stringValues(attributes[input.roleAttribute])
        : [],
  };
}

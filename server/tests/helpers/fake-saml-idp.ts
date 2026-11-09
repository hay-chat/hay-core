import * as crypto from "crypto";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import { SignedXml } from "xml-crypto";

/**
 * A SAML identity provider that never listens on a port: it reads the
 * AuthnRequest out of the redirect URL and returns signed responses, including
 * deliberately broken ones. Signatures are real (xml-crypto, RSA-SHA256,
 * exclusive canonicalization), so the code under test verifies actual XML
 * signatures, not a stub.
 */

const EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const NS_SAML = "urn:oasis:names:tc:SAML:2.0:assertion";
const NS_SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";

interface KeyMaterial {
  privateKey: string;
  certificate: string;
}

function generateKeyMaterial(commonName: string, days = 30): KeyMaterial {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-saml-idp-"));
  try {
    const key = path.join(dir, "key.pem");
    const cert = path.join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256"],
        ...["-keyout", key, "-out", cert, "-subj", `/CN=${commonName}`, "-days", String(days)],
      ],
      { stdio: "ignore" },
    );
    return {
      privateKey: fs.readFileSync(key, "utf8"),
      certificate: fs.readFileSync(cert, "utf8"),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface AuthnRequest {
  id: string;
  issuer: string;
  acsUrl: string;
  relayState: string;
}

export type Signing = "assertion" | "response" | "both" | "none" | "other-key";

export interface FakeResponseOptions {
  nameId?: string;
  nameIdFormat?: string;
  /** Attribute name to values. */
  attributes?: Record<string, string[]>;
  /** Replaces the request id in InResponseTo (response and confirmation); null omits it. */
  inResponseTo?: string | null;
  recipient?: string;
  audience?: string;
  issuer?: string;
  /** Seconds relative to now. */
  notBeforeOffset?: number;
  notOnOrAfterOffset?: number;
  assertionId?: string;
  signing?: Signing;
  /** Raw XML injected inside the NameID text, before signing (comment injection). */
  nameIdMarkup?: string;
  /** Changes the document after it was signed. */
  tamper?: (xml: string) => string;
  /** Builds the final Response from the signed assertion and the header parts. */
  assemble?: (parts: { assertion: string; responseOpen: string; header: string }) => string;
  /** Leaves out the bearer SubjectConfirmation. */
  noConfirmation?: boolean;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function instant(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

export class FakeSamlIdp {
  readonly entityId = "https://idp.saml-test.example/metadata";
  readonly ssoUrl = "https://idp.saml-test.example/sso";
  private readonly main: KeyMaterial = generateKeyMaterial("hay-test-idp");
  private readonly other: KeyMaterial = generateKeyMaterial("hay-test-other-key");

  get certificate(): string {
    return this.main.certificate;
  }

  get otherCertificate(): string {
    return this.other.certificate;
  }

  /** Reads what the service provider put in the redirect URL. */
  decodeRedirect(redirectUrl: string): AuthnRequest {
    const url = new URL(redirectUrl);
    const samlRequest = url.searchParams.get("SAMLRequest");
    if (!samlRequest) throw new Error("no SAMLRequest in the redirect");
    const xml = zlib.inflateRawSync(Buffer.from(samlRequest, "base64")).toString("utf8");
    const pick = (pattern: RegExp) => {
      const match = pattern.exec(xml);
      if (!match) throw new Error(`AuthnRequest lacks ${pattern}`);
      return match[1];
    };
    return {
      id: pick(/<samlp:AuthnRequest[^>]*\sID="([^"]+)"/),
      issuer: pick(/<saml:Issuer[^>]*>([^<]+)<\/saml:Issuer>/),
      acsUrl: pick(/AssertionConsumerServiceURL="([^"]+)"/),
      relayState: url.searchParams.get("RelayState") ?? "",
    };
  }

  private sign(xml: string, key: KeyMaterial, referenceXpath: string, afterXpath: string): string {
    const signer = new SignedXml({
      privateKey: key.privateKey,
      publicCert: key.certificate,
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      canonicalizationAlgorithm: EXC_C14N,
    });
    signer.addReference({
      xpath: referenceXpath,
      transforms: [ENVELOPED, EXC_C14N],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
    signer.computeSignature(xml, { location: { reference: afterXpath, action: "after" } });
    return signer.getSignedXml();
  }

  /** A complete response for a request, as the base64 a browser would POST. */
  respond(request: AuthnRequest, options: FakeResponseOptions = {}): string {
    const signing = options.signing ?? "assertion";
    const issuer = options.issuer ?? this.entityId;
    const requestId = options.inResponseTo === undefined ? request.id : options.inResponseTo;
    const inResponseTo = requestId === null ? "" : ` InResponseTo="${requestId}"`;
    const nameId = options.nameId ?? "person@acme-saml.test";
    const attributes = options.attributes ?? { email: [nameId] };
    const attributeXml = Object.entries(attributes)
      .map(
        ([name, values]) =>
          `<saml:Attribute Name="${escapeXml(name)}">${values
            .map(
              (value) =>
                `<saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">${escapeXml(value)}</saml:AttributeValue>`,
            )
            .join("")}</saml:Attribute>`,
      )
      .join("");
    const confirmation = options.noConfirmation
      ? ""
      : `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${instant(options.notOnOrAfterOffset ?? 300)}" Recipient="${options.recipient ?? request.acsUrl}"${inResponseTo}/></saml:SubjectConfirmation>`;

    const assertionId = options.assertionId ?? `_a${crypto.randomBytes(12).toString("hex")}`;
    let assertion =
      `<saml:Assertion xmlns:saml="${NS_SAML}" ID="${assertionId}" Version="2.0" IssueInstant="${instant()}">` +
      `<saml:Issuer>${issuer}</saml:Issuer>` +
      `<saml:Subject><saml:NameID Format="${options.nameIdFormat ?? "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent"}">${escapeXml(nameId)}${options.nameIdMarkup ?? ""}</saml:NameID>${confirmation}</saml:Subject>` +
      `<saml:Conditions NotBefore="${instant(options.notBeforeOffset ?? -5)}" NotOnOrAfter="${instant(options.notOnOrAfterOffset ?? 300)}"><saml:AudienceRestriction><saml:Audience>${options.audience ?? request.issuer}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${instant()}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
      `<saml:AttributeStatement>${attributeXml}</saml:AttributeStatement>` +
      `</saml:Assertion>`;

    if (signing === "assertion" || signing === "both") {
      assertion = this.sign(
        assertion,
        this.main,
        "//*[local-name(.)='Assertion']",
        "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      );
    } else if (signing === "other-key") {
      assertion = this.sign(
        assertion,
        this.other,
        "//*[local-name(.)='Assertion']",
        "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      );
    }

    const responseOpen = `<samlp:Response xmlns:samlp="${NS_SAMLP}" xmlns:saml="${NS_SAML}" ID="_r${crypto.randomBytes(12).toString("hex")}" Version="2.0" IssueInstant="${instant()}" Destination="${request.acsUrl}"${inResponseTo}>`;
    const header = `<saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`;
    let response = options.assemble
      ? options.assemble({ assertion, responseOpen, header })
      : `${responseOpen}${header}${assertion}</samlp:Response>`;

    if (signing === "response" || signing === "both") {
      response = this.sign(
        response,
        this.main,
        "/*[local-name(.)='Response']",
        "/*[local-name(.)='Response']/*[local-name(.)='Issuer']",
      );
    }
    if (options.tamper) response = options.tamper(response);
    return Buffer.from(response, "utf8").toString("base64");
  }

  /** Unsigned assertion XML for a different person, to be slipped in next to a signed one. */
  forgedAssertion(request: AuthnRequest, nameId: string): string {
    return (
      `<saml:Assertion xmlns:saml="${NS_SAML}" ID="_forged" Version="2.0" IssueInstant="${instant()}">` +
      `<saml:Issuer>${this.entityId}</saml:Issuer>` +
      `<saml:Subject><saml:NameID>${escapeXml(nameId)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${instant(300)}" Recipient="${request.acsUrl}" InResponseTo="${request.id}"/></saml:SubjectConfirmation></saml:Subject>` +
      `<saml:Conditions NotBefore="${instant(-5)}" NotOnOrAfter="${instant(300)}"><saml:AudienceRestriction><saml:Audience>${request.issuer}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
      `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${escapeXml(nameId)}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
      `</saml:Assertion>`
    );
  }
}

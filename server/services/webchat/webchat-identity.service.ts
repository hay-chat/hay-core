/**
 * Webchat customer identity (D1).
 *
 * A widget may say which store customer the shopper is (`customerExternalId`)
 * so the conversation links to that customer's record and history. The id
 * comes from the shopper's browser, so on its own it proves nothing: the
 * store's server signs it with the organization's identity secret and the
 * widget passes the signature along. Only a valid signature links the
 * conversation; an unsigned or wrongly signed id gets a fresh anonymous
 * customer, like a visitor who sent no id.
 *
 *   signature = hex(HMAC-SHA256(identitySecret, customerExternalId))
 *
 * The secret is per organization, stored encrypted, generated the first time
 * an admin reveals it, and replaced on rotate (old signatures stop working).
 */

import crypto from "crypto";
import { AppDataSource } from "@server/database/data-source";
import { WebchatSettings } from "@server/database/entities/webchat-settings.entity";
import { webchatSettingsRepository } from "@server/repositories/webchat-settings.repository";
import { encryptValue, decryptValue } from "@server/lib/auth/utils/encryption";

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

/** hex HMAC-SHA256 of the external id. What the store's server computes. */
export function signCustomerExternalId(secret: string, customerExternalId: string): string {
  return crypto.createHmac("sha256", secret).update(customerExternalId, "utf8").digest("hex");
}

/** Constant-time check of a hex signature against the expected one. */
export function isValidCustomerExternalIdSignature(
  secret: string,
  customerExternalId: string,
  signature: string,
): boolean {
  if (!SIGNATURE_PATTERN.test(signature)) return false;
  const expected = Buffer.from(signCustomerExternalId(secret, customerExternalId), "hex");
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

// Decrypting runs PBKDF2, too slow for every widget create. The ciphertext is
// re-read each time, so a rotation takes effect at once.
const decryptedSecrets = new Map<string, { cipherText: string; secret: string }>();

async function storedCipherText(organizationId: string): Promise<string | null> {
  const row = await AppDataSource.getRepository(WebchatSettings)
    .createQueryBuilder("settings")
    .select("settings.id")
    .addSelect("settings.identitySecret")
    .where("settings.organizationId = :organizationId", { organizationId })
    .getOne();
  return row?.identitySecret ?? null;
}

function decryptCached(organizationId: string, cipherText: string): string {
  const cached = decryptedSecrets.get(organizationId);
  if (cached?.cipherText === cipherText) return cached.secret;
  const secret = decryptValue(cipherText);
  if (decryptedSecrets.size > 5000) decryptedSecrets.clear();
  decryptedSecrets.set(organizationId, { cipherText, secret });
  return secret;
}

async function storeNewSecret(organizationId: string): Promise<string> {
  const secret = crypto.randomBytes(32).toString("hex");
  await webchatSettingsRepository.update(organizationId, { identitySecret: encryptValue(secret) });
  return secret;
}

/** The organization's identity secret, created on first use. Admins only. */
export async function revealIdentitySecret(organizationId: string): Promise<string> {
  const cipherText = await storedCipherText(organizationId);
  return cipherText ? decryptCached(organizationId, cipherText) : storeNewSecret(organizationId);
}

/** Replace the secret. Ids signed with the old one no longer link. */
export async function rotateIdentitySecret(organizationId: string): Promise<string> {
  return storeNewSecret(organizationId);
}

/**
 * The external id the widget may link, or null when it is missing, unsigned,
 * wrongly signed, or the organization has no secret yet.
 */
export async function verifiedCustomerExternalId(
  organizationId: string,
  customerExternalId: string | undefined,
  signature: string | undefined,
): Promise<string | null> {
  if (!customerExternalId || !signature) return null;
  const cipherText = await storedCipherText(organizationId);
  if (!cipherText) return null;
  const secret = decryptCached(organizationId, cipherText);
  return isValidCustomerExternalIdSignature(secret, customerExternalId, signature)
    ? customerExternalId
    : null;
}

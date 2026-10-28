import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import crypto from "crypto";

/**
 * D1: a widget's customerExternalId links a customer only when the store's
 * server signed it with the organization's identity secret.
 */

let storedCipherText: string | null = null;
const getOne = jest.fn(async () =>
  storedCipherText === null ? null : { identitySecret: storedCipherText },
);
const queryBuilder = {
  select: () => queryBuilder,
  addSelect: () => queryBuilder,
  where: () => queryBuilder,
  getOne,
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => ({ createQueryBuilder: () => queryBuilder }) },
}));

const mockUpdate = jest.fn(async (_orgId: string, data: { identitySecret?: string | null }) => {
  storedCipherText = data.identitySecret ?? null;
  return {};
});
jest.mock("@server/repositories/webchat-settings.repository", () => ({
  webchatSettingsRepository: { update: mockUpdate },
}));

const mockDecrypt = jest.fn((cipherText: string) => cipherText.replace(/^enc:/, ""));
jest.mock("@server/lib/auth/utils/encryption", () => ({
  encryptValue: (text: string) => `enc:${text}`,
  decryptValue: mockDecrypt,
}));

import {
  signCustomerExternalId,
  isValidCustomerExternalIdSignature,
  revealIdentitySecret,
  rotateIdentitySecret,
  verifiedCustomerExternalId,
} from "@server/services/webchat/webchat-identity.service";

const ORG_ID = "org-identity";

describe("customerExternalId signatures", () => {
  it("is the hex HMAC-SHA256 of the id, so any server language can compute it", () => {
    const expected = crypto.createHmac("sha256", "s3cret").update("ana@shop.com").digest("hex");
    expect(signCustomerExternalId("s3cret", "ana@shop.com")).toBe(expected);
  });

  it("accepts the right signature in either case and refuses anything else", () => {
    const signature = signCustomerExternalId("s3cret", "42");
    expect(isValidCustomerExternalIdSignature("s3cret", "42", signature)).toBe(true);
    expect(isValidCustomerExternalIdSignature("s3cret", "42", signature.toUpperCase())).toBe(true);
    expect(isValidCustomerExternalIdSignature("s3cret", "43", signature)).toBe(false);
    expect(isValidCustomerExternalIdSignature("other", "42", signature)).toBe(false);
    expect(isValidCustomerExternalIdSignature("s3cret", "42", "")).toBe(false);
    expect(isValidCustomerExternalIdSignature("s3cret", "42", signature.slice(2))).toBe(false);
    expect(isValidCustomerExternalIdSignature("s3cret", "42", "zz" + signature.slice(2))).toBe(
      false,
    );
  });
});

describe("identity secret", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storedCipherText = null;
  });

  it("is created encrypted on first reveal and the same afterwards", async () => {
    const secret = await revealIdentitySecret(ORG_ID);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(storedCipherText).toBe(`enc:${secret}`);
    expect(await revealIdentitySecret(ORG_ID)).toBe(secret);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("rotating replaces it, so the old signature stops linking", async () => {
    const before = await revealIdentitySecret(ORG_ID);
    const signature = signCustomerExternalId(before, "ana@shop.com");
    expect(await verifiedCustomerExternalId(ORG_ID, "ana@shop.com", signature)).toBe(
      "ana@shop.com",
    );

    const after = await rotateIdentitySecret(ORG_ID);

    expect(after).not.toBe(before);
    expect(await verifiedCustomerExternalId(ORG_ID, "ana@shop.com", signature)).toBeNull();
    expect(
      await verifiedCustomerExternalId(
        ORG_ID,
        "ana@shop.com",
        signCustomerExternalId(after, "ana@shop.com"),
      ),
    ).toBe("ana@shop.com");
  });

  it("decrypts once per stored secret, not on every widget create", async () => {
    storedCipherText = "enc:cached-secret";
    const signature = signCustomerExternalId("cached-secret", "7");
    await verifiedCustomerExternalId("org-cache", "7", signature);
    await verifiedCustomerExternalId("org-cache", "7", signature);
    expect(mockDecrypt).toHaveBeenCalledTimes(1);
  });
});

describe("verifiedCustomerExternalId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storedCipherText = "enc:org-secret";
  });

  it("links nothing without an id or a signature, and does not read the secret", async () => {
    expect(await verifiedCustomerExternalId(ORG_ID, undefined, "a".repeat(64))).toBeNull();
    expect(await verifiedCustomerExternalId(ORG_ID, "ana@shop.com", undefined)).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  it("links nothing while the organization has no secret", async () => {
    storedCipherText = null;
    const signature = signCustomerExternalId("org-secret", "ana@shop.com");
    expect(await verifiedCustomerExternalId(ORG_ID, "ana@shop.com", signature)).toBeNull();
  });

  it("refuses an id signed for someone else", async () => {
    const signature = signCustomerExternalId("org-secret", "bob@shop.com");
    expect(await verifiedCustomerExternalId(ORG_ID, "ana@shop.com", signature)).toBeNull();
  });
});

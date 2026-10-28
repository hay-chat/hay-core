/**
 * Every tool must carry a risk class (core holds unclassified tools as unknown
 * writes), and the refund must be a held `refund`.
 */
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const { createFakeServer } = require("./harness");
const { riskFor, CATEGORY_META_KEY } = require("@hay/plugin-sdk/tool-risk");
const { contractToolNames } = require("@hay/plugin-sdk/payment-provider");
const { registerPaymentTools } = require("../tools/payments");
const toolRisk = require("../tool-risk");

describe("tool risk", () => {
  const server = createFakeServer();
  registerPaymentTools(server);
  const names = [...server.tools.keys()];

  it("registers exactly the payment_provider contract tools", () => {
    expect(names.sort()).toEqual(Object.values(contractToolNames("mercadopago")).sort());
  });

  it("classifies every tool; the refund is destructive and categorised refund", () => {
    expect(names.filter((n) => riskFor(n, toolRisk) === null)).toEqual([]);
    const refund = riskFor("mercadopago_refund", toolRisk);
    expect(refund.annotations.destructiveHint).toBe(true);
    expect(refund._meta[CATEGORY_META_KEY]).toBe("refund");
    expect(riskFor("mercadopago_resend_payment", toolRisk).annotations.readOnlyHint).toBe(true);
  });

  it("has an i18n label for every tool in en and pt-BR", () => {
    for (const lang of ["en", "pt-BR"]) {
      const i18n = require(`../../i18n/${lang}.json`);
      expect(Object.keys(i18n.tools).sort()).toEqual([...names].sort());
    }
  });
});

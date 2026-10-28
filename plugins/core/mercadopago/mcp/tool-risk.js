/**
 * Risk class of every tool this server registers (see @hay/plugin-sdk/tool-risk).
 * All five come from the payment_provider contract: mercadopago_refund is a
 * `refund` (destructive, held for approval under the org's action policy), the
 * rest are reads. tests/tool-risk.test.js keeps it complete.
 */
const { contractToolRisk } = require("@hay/plugin-sdk/payment-provider");

module.exports = contractToolRisk("mercadopago");

/**
 * Order meta_data as each Brazilian gateway plugin leaves it on an unpaid Pix
 * order (shapes from plugin source per the D10 research; Pagar.me and Asaas keys
 * are unverified until checked on a live store). Codes are syntactically valid
 * EMV-style payloads, not real charges.
 */
const CODE =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Loja Teste6009SAO PAULO62070503***6304ABCD";

module.exports = {
  CODE,
  mercadopago: [
    { id: 1, key: "_Mercado_Pago_Payment_IDs", value: "1234567890" },
    { id: 2, key: "mp_pix_qr_code", value: CODE },
    { id: 3, key: "mp_pix_qr_base64", value: "iVBORw0KGgoAAAANSUhEUgAA..." },
  ],
  pagbank: [
    { id: 1, key: "_pagbank_charge_id", value: "CHAR_ABC" },
    { id: 2, key: "_pagbank_pix_text", value: CODE },
    { id: 3, key: "_pagbank_pix_qr_code", value: "https://api.pagseguro.com/qrcode/QRCO_1/png" },
    { id: 4, key: "_pagbank_pix_expiration_date", value: "2026-10-30T23:59:00-03:00" },
  ],
  pagbankConnect: [
    { id: 1, key: "pagbank_order_id", value: "ORDE_1" },
    { id: 2, key: "pix_qrcode_text", value: CODE },
    { id: 3, key: "pix_qrcode", value: "https://sandbox.api.pagseguro.com/qrcode/QRCO_2/png" },
    { id: 4, key: "pix_qrcode_expiration", value: "2026-10-30 23:59:00" },
  ],
  pagarme: [
    {
      id: 1,
      key: "_pagarme_response_data",
      value: JSON.stringify({
        id: "or_1",
        charges: [
          {
            id: "ch_1",
            last_transaction: {
              transaction_type: "pix",
              qr_code: CODE,
              qr_code_url:
                "https://api.pagar.me/core/v5/transactions/tran_1/qrcode?payment_method=pix",
              expires_at: "2026-10-30T23:59:00Z",
            },
          },
        ],
      }),
    },
  ],
  asaas: [
    {
      id: 1,
      key: "__ASAAS_ORDER",
      value: {
        id: "pay_1",
        billingType: "PIX",
        pixQrCode: {
          payload: CODE,
          encodedImage: "iVBORw0K...",
          expirationDate: "2026-10-30 23:59:59",
        },
      },
    },
  ],
};

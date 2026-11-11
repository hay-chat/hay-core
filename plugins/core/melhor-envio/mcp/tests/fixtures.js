/**
 * Melhor Envio order objects, cut down from the documented response examples
 * (docs.melhorenvio.com.br/reference/pesquisar-etiqueta and
 * /listar-informacoes-de-uma-etiqueta).
 */

function order(overrides = {}) {
  return {
    id: "34105e98-bb32-4e85-8b0f-8bd2c888eb31",
    protocol: "ORD-20220395517",
    service_id: 1,
    delivery_min: 8,
    delivery_max: 9,
    status: "posted",
    reverse: false,
    authorization_code: "2022032920",
    tracking: "ME220021P96BR",
    self_tracking: "ME220021P96BR",
    paid_at: "2022-03-29 20:43:37",
    generated_at: "2022-03-29 20:43:50",
    posted_at: "2022-03-29 21:00:06",
    delivered_at: null,
    canceled_at: null,
    suspended_at: null,
    expired_at: null,
    created_at: "2022-03-29 20:24:51",
    updated_at: "2022-03-29 21:00:06",
    from: {
      name: "Teste ME",
      email: "loja@store.test",
      document: "16571478358",
      company_document: "04517623000197",
      city: "Guarulhos",
      state_abbr: "SP",
      country_id: "BR",
    },
    to: {
      name: "Maria Souza Teste",
      phone: "11999990000",
      email: "maria@example.com",
      document: "73646548010",
      company_document: null,
      address: "Avenida Marechal Floriano Peixoto",
      city: "Nova Iguacu",
      state_abbr: "RJ",
      country_id: "BR",
    },
    service: {
      id: 1,
      name: "PAC",
      company: { id: 1, name: "Correios", picture: "/images/shipping-companies/correios.png" },
    },
    ...overrides,
  };
}

module.exports = { order };

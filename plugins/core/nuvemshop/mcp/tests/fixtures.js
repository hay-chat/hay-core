/** Shared fixtures: a paid, unpacked Pix order on store 1 (API 2025-03). */

process.env.NUVEMSHOP_STORE_ID = "1";
process.env.NUVEMSHOP_ACCESS_TOKEN = "tok";
process.env.NUVEMSHOP_API_VERSION = "2025-03";
process.env.NUVEMSHOP_MAIN_LANGUAGE = "pt";

const BASE = "/2025-03/1";

function makeOrder(overrides = {}) {
  return {
    id: 900,
    number: 101,
    status: "open",
    payment_status: "paid",
    shipping_status: "unpacked",
    currency: "BRL",
    created_at: "2026-10-20T10:00:00+0000",
    paid_at: "2026-10-20T10:05:00+0000",
    subtotal: "100.00",
    discount: "0.00",
    shipping_cost_customer: "20.00",
    total: "120.00",
    gateway: "nuvem_pago",
    gateway_name: "Nuvem Pago",
    payment_details: { method: "pix", credit_card_company: null, installments: 1 },
    contact_email: "ana@example.com",
    contact_phone: "+55 11 91234-5678",
    contact_name: "Ana Souza",
    customer: { id: 77, name: "Ana Souza", email: "ana@example.com", phone: "11912345678" },
    owner_note: null,
    shipping_address: {
      name: "Ana Souza",
      address: "Rua A",
      number: "10",
      city: "São Paulo",
      province: "São Paulo",
      zipcode: "01000-000",
      country: "BR",
    },
    products: [
      {
        id: 1,
        product_id: 5,
        variant_id: 50,
        name: "Camiseta",
        sku: "CAM-P",
        quantity: "2",
        price: "50.00",
      },
    ],
    ...overrides,
  };
}

function makeFulfillment(overrides = {}) {
  return {
    id: "01FO",
    status: "UNPACKED",
    tracking_info: { code: null, url: null },
    shipping: {
      type: "ship",
      carrier: { name: "Correios" },
      option: { name: "PAC" },
      min_delivery_date: "2026-10-25",
      max_delivery_date: "2026-10-28",
    },
    destination: {
      zipcode: "01000-000",
      street: "Rua A",
      number: "10",
      city: "São Paulo",
      province: { name: "São Paulo", code: "SP" },
      country: { name: "Brasil", code: "BR" },
    },
    recipient: { name: "Ana Souza", phone: "11912345678" },
    labels: [],
    tracking_events: [],
    ...overrides,
  };
}

/** Routes for one order: GET by id, ?q= search (contains-match), fulfillment orders, transactions. */
function orderRoutes(
  order,
  { fulfillments = [makeFulfillment()], transactions = null, extra = [] } = {},
) {
  return [
    ...extra,
    { method: "GET", path: `${BASE}/orders/${order.id}`, reply: () => order },
    {
      method: "GET",
      path: `${BASE}/orders`,
      reply: ({ query }) => {
        const q = query.get("q");
        const ids = query.get("customer_ids");
        if (ids) return String(order.customer?.id) === ids ? [order] : [];
        // Mimic the fuzzy contains-match: a lookalike order comes first.
        const lookalike = {
          ...order,
          id: 901,
          number: Number(`${order.number}0`),
          contact_email: "other@example.com",
          customer: { id: 78, email: "other@example.com" },
        };
        if (q && (String(order.number).includes(q) || order.contact_email.includes(q)))
          return [lookalike, order];
        return [];
      },
    },
    {
      method: "GET",
      path: `${BASE}/orders/${order.id}/fulfillment-orders`,
      reply: () => fulfillments,
    },
    {
      method: "GET",
      path: `${BASE}/orders/${order.id}/transactions`,
      reply: () =>
        transactions === null ? { status: 403, body: { description: "Forbidden" } } : transactions,
    },
  ];
}

module.exports = { BASE, makeOrder, makeFulfillment, orderRoutes };

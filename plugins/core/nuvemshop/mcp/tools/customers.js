/**
 * Customer tools.
 *
 *   nuvemshop_find_customer         GET /customers?email= | ?q=<CPF/CNPJ/DNI>, verified
 *   nuvemshop_get_customer          GET /customers/{id}
 *   nuvemshop_list_customer_orders  GET /orders?customer_ids= | ?q=<email> verified
 *
 * Every search hit is verified: `q` is a contains-match, so an email or a
 * document number must match exactly before a customer or order is returned.
 * Nuvemshop's customer search does not cover phone numbers, so phone-only
 * lookups are refused with a pointer to email or order number.
 */

const { z } = require("zod");
const { nsApi, nsList, NuvemshopApiError } = require("../lib/client");
const { ok, fail, toolError, sameEmail, digits, READ } = require("../lib/format");
const { summarizeOrder } = require("../lib/orders");

function summarizeCustomer(c) {
  return {
    id: c.id,
    name: c.name ?? null,
    email: c.email ?? null,
    phone: c.phone || null,
    identification: c.identification || null,
    totalSpent: c.total_spent ?? null,
    currency: c.total_spent_currency ?? null,
    lastOrderId: c.last_order_id ?? null,
    createdAt: c.created_at ?? null,
  };
}

function address(a) {
  if (!a) return null;
  return {
    name: a.name ?? null,
    address: a.address ?? null,
    number: a.number ?? null,
    floor: a.floor ?? null,
    locality: a.locality ?? null,
    city: a.city ?? null,
    province: a.province ?? null,
    zipcode: a.zipcode ?? null,
    country: a.country ?? null,
    phone: a.phone ?? null,
  };
}

async function findByEmail(email) {
  const { items } = await nsList("/customers", { email, per_page: 5 });
  const hit = items.find((c) => sameEmail(c.email, email));
  if (hit) return hit;
  // Older API versions ignore `email`; `q` also covers email (contains-match).
  const { items: fuzzy } = await nsList("/customers", { q: email, per_page: 10 });
  return fuzzy.find((c) => sameEmail(c.email, email)) || null;
}

async function findByDocument(doc) {
  const wanted = digits(doc);
  if (wanted.length < 6) throw toolError("BAD_INPUT", `"${doc}" is not a CPF/CNPJ/DNI.`);
  const { items } = await nsList("/customers", { q: wanted, per_page: 10 });
  return items.find((c) => digits(c.identification) === wanted) || null;
}

/** Orders by email: account orders by id, else guest orders verified by contact email. */
async function ordersForEmail(email, { perPage, page }, account) {
  const paging = { status: "any", per_page: perPage, page };
  if (account) {
    const { items, total } = await nsList("/orders", { customer_ids: account.id, ...paging });
    return { items, total };
  }
  const { items } = await nsList("/orders", { q: email, ...paging });
  return {
    items: items.filter(
      (o) => sameEmail(o.contact_email, email) || sameEmail(o.customer?.email, email),
    ),
    total: null, // the q total counts fuzzy hits
  };
}

function registerCustomerTools(server) {
  server.registerTool(
    "nuvemshop_find_customer",
    {
      description:
        "Find a customer by email (exact) or by CPF/CNPJ/DNI, with their 5 most recent orders " +
        "(recentOrders, with ids and numbers) so the next step needs no extra lookup. Also " +
        "finds guest orders placed with that email. found=false when nothing matches. Phone " +
        "search is not supported by Nuvemshop: ask for the email or the order number.",
      inputSchema: {
        email: z.string().optional().describe("Email address used at checkout."),
        identification: z
          .string()
          .optional()
          .describe("Customer's document number (CPF/CNPJ in Brazil, DNI/CUIT elsewhere)."),
      },
      annotations: READ,
    },
    async ({ email, identification }) => {
      try {
        const e = email?.trim() || undefined;
        const d = identification?.trim() || undefined;
        if (!e && !d) {
          throw toolError(
            "BAD_INPUT",
            "Provide an email or a document number. Nuvemshop cannot search customers by phone.",
          );
        }
        const account = e ? await findByEmail(e) : await findByDocument(d);
        const lookupEmail = e || account?.email;
        const { items: orders } = lookupEmail
          ? await ordersForEmail(lookupEmail, { perPage: 5, page: 1 }, account)
          : { items: [] };
        if (!account && !orders.length) {
          return ok({
            found: false,
            message: `No customer or orders found for ${e || d}. Ask for the email used at checkout.`,
          });
        }
        const first = orders[0];
        return ok({
          found: true,
          customer: account
            ? { ...summarizeCustomer(account), isGuest: false }
            : {
                id: first?.customer?.id ?? null,
                isGuest: true,
                name: first?.contact_name || first?.customer?.name || null,
                email: first?.contact_email || e,
                phone: first?.contact_phone || null,
              },
          recentOrders: orders.slice(0, 5).map(summarizeOrder),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_get_customer",
    {
      description:
        "Get a customer by id with contact details, default and saved addresses, total spent " +
        "and last order id.",
      inputSchema: { customer_id: z.string().describe("Nuvemshop customer id.") },
      annotations: READ,
    },
    async ({ customer_id: customerId }) => {
      try {
        let c;
        try {
          c = await nsApi("GET", `/customers/${encodeURIComponent(customerId)}`);
        } catch (err) {
          if (err instanceof NuvemshopApiError && err.status === 404) {
            throw toolError(
              "NOT_FOUND",
              `Customer ${customerId} not found. Search by email with nuvemshop_find_customer.`,
            );
          }
          throw err;
        }
        return ok({
          ...summarizeCustomer(c),
          note: c.note || null,
          defaultAddress: address(c.default_address),
          addresses: (c.addresses || []).slice(0, 10).map(address),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "nuvemshop_list_customer_orders",
    {
      description:
        "List a customer's orders by email (account or guest), most recent first, one page at " +
        "a time. Includes cancelled and closed orders.",
      inputSchema: {
        email: z.string().describe("Email address used at checkout."),
        limit: z.number().int().min(1).optional().describe("Orders per page (default 10, max 50)."),
        page: z.number().int().min(1).optional().describe("Page number (default 1)."),
      },
      annotations: READ,
    },
    async ({ email, limit, page }) => {
      try {
        const perPage = Math.min(limit ?? 10, 50);
        const account = await findByEmail(email.trim());
        const { items, total } = await ordersForEmail(
          email.trim(),
          { perPage, page: page ?? 1 },
          account,
        );
        items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        return ok({
          customerId: account?.id ?? null,
          isGuest: !account,
          items: items.map(summarizeOrder),
          page: page ?? 1,
          total: account ? total : null,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools, summarizeCustomer };

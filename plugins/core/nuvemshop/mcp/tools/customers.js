// tools/customers.js — Nuvemshop customer lookups.
// Registrar: registerCustomerTools
//
// Exactly two lookups on purpose (find + get) — overlapping lookup tools waste
// an agent decision. No customer create/update: support flows read customers
// and act on orders.

const { z } = require("zod");
const { nuvemshopApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function slimCustomer(customer) {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone || undefined,
    identification: customer.identification || undefined,
    total_spent: customer.total_spent,
    last_order_id: customer.last_order_id || undefined,
    default_address: customer.default_address || undefined,
    note: customer.note || undefined,
    created_at: customer.created_at,
  };
}

function registerCustomerTools(server) {
  server.tool(
    "nuvemshop_find_customer",
    "Find customers by email (exact match) or by free text over name/email/identification " +
      "(CPF/CNPJ/DNI). Use the returned id with nuvemshop_list_customer_orders.",
    {
      email: z.string().optional().describe("Customer email — matched exactly"),
      query: z
        .string()
        .optional()
        .describe("Free text matched against name, email or identification document"),
      first: z.number().int().optional().describe("Max results (default 10)"),
    },
    async (args) => {
      try {
        const term = args.email ?? args.query;
        if (!term) {
          throw new Error("Provide email or query.");
        }
        const results = await nuvemshopApi("GET", "/customers", {
          query: { q: term, per_page: Math.min(args.first ?? 10, 200) },
        });
        let customers = results ?? [];
        if (args.email) {
          // `q` is a contains-match; enforce exactness for email lookups so the
          // agent never acts on a lookalike account.
          const wanted = args.email.trim().toLowerCase();
          customers = customers.filter(
            (customer) => (customer.email || "").toLowerCase() === wanted,
          );
        }
        return ok(customers.map(slimCustomer));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "nuvemshop_get_customer",
    "Get a customer's full detail by ID, including addresses, total spent and last order.",
    {
      customer_id: z.number().int().describe("Numeric customer ID"),
    },
    async (args) => {
      try {
        const customer = await nuvemshopApi("GET", `/customers/${args.customer_id}`);
        return ok({
          ...slimCustomer(customer),
          addresses: customer.addresses,
        });
      } catch (err) {
        if (err && err.status === 404) {
          return fail(
            new Error(
              `Customer ${args.customer_id} not found. Search by email with ` +
                "nuvemshop_find_customer.",
            ),
          );
        }
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools };

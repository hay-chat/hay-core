// tools/customers.js — Shopify Admin GraphQL MCP tools for customers (API 2026-04)
// Read side uses defaultEmailAddress/defaultPhoneNumber (top-level email/phone are
// deprecated on Customer in 2026-04). Exactly two lookups on purpose: find (email or
// phone → list for disambiguation) and get (by id, enriched) — overlapping lookup
// tools waste an agent decision and get picked wrong.

const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const {
  ok,
  fail,
  unwrapConnection,
  pageInfo,
  toGid,
  assertNoUserErrors,
} = require("../lib/format");

function registerCustomerTools(server) {
  // 1. Find customers by email and/or phone
  server.tool(
    "shopify_find_customer",
    "Find customers by email address and/or phone number. Returns a list (may be empty or " +
      "contain several matches — disambiguate with the customer before acting). Follow up " +
      "with shopify_get_customer for full detail and recent orders.",
    {
      email: z.string().optional().describe("Email address to search for."),
      phone: z
        .string()
        .optional()
        .describe("Phone number to search for, ideally E.164 (e.g. +15551234567)."),
      first: z
        .number()
        .int()
        .optional()
        .describe("Max number of customers to return (default 10)."),
    },
    async (args) => {
      try {
        if (!args.email && !args.phone) {
          throw new Error("Provide an email and/or a phone number to search for.");
        }
        // Shopify search syntax: `email:` and `phone:` filters, uppercase OR.
        const parts = [];
        if (args.email) parts.push(`email:"${args.email}"`);
        if (args.phone) parts.push(`phone:"${args.phone}"`);
        const query = `
          query FindCustomer($first: Int!, $query: String!) {
            customers(first: $first, query: $query) {
              edges {
                node {
                  id
                  firstName
                  lastName
                  defaultEmailAddress { emailAddress }
                  defaultPhoneNumber { phoneNumber }
                  numberOfOrders
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        `;
        const variables = {
          first: args.first ?? 10,
          query: parts.join(" OR "),
        };
        const data = await shopifyGql(query, variables);
        const conn = data.customers;
        return ok({
          items: unwrapConnection(conn),
          pageInfo: pageInfo(conn),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 2. Get a customer by id (full detail + recent orders)
  server.tool(
    "shopify_get_customer",
    "Get full details for a customer by id, including their 5 most recent orders " +
      "(name, status, date, total) — usually no separate order-list call is needed.",
    {
      customerId: z.string().describe("Customer GID or bare numeric id."),
    },
    async (args) => {
      try {
        // recentOrders capped at 5: enough to collapse the email→customer→orders
        // flow into one call without blowing up context for long-tenured customers.
        const query = `
          query GetCustomer($id: ID!) {
            customer(id: $id) {
              id
              firstName
              lastName
              defaultEmailAddress { emailAddress marketingState }
              defaultPhoneNumber { phoneNumber }
              numberOfOrders
              amountSpent { amount currencyCode }
              note
              tags
              createdAt
              defaultAddress {
                id
                address1
                address2
                city
                provinceCode
                countryCode
                zip
                firstName
                lastName
                phone
                company
              }
              orders(first: 5, sortKey: CREATED_AT, reverse: true) {
                edges {
                  node {
                    id
                    name
                    createdAt
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } }
                  }
                }
              }
            }
          }
        `; // TODO(HAY-219 §8): verify defaultEmailAddress.marketingState exists in 2026-04 against a real dev store.
        const data = await shopifyGql(query, { id: toGid("Customer", args.customerId) });
        const customer = data.customer;
        if (!customer) return ok(null);
        const { orders, ...rest } = customer;
        return ok({ ...rest, recentOrders: unwrapConnection(orders) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 3. Update a customer (WRITE)
  server.tool(
    "shopify_update_customer",
    "Update a customer's basic fields (WRITE).",
    {
      customerId: z.string().describe("Customer GID or bare numeric id."),
      firstName: z.string().optional().describe("Customer first name."),
      lastName: z.string().optional().describe("Customer last name."),
      email: z.string().optional().describe("Customer email address."),
      phone: z.string().optional().describe("Customer phone number."),
      note: z.string().optional().describe("Internal note about the customer."),
      tags: z.array(z.string()).optional().describe("Tags to set on the customer."),
    },
    async (args) => {
      try {
        const mutation = `
          mutation UpdateCustomer($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer {
                id
                firstName
                lastName
                defaultEmailAddress { emailAddress }
                defaultPhoneNumber { phoneNumber }
                note
                tags
              }
              userErrors { field message }
            }
          }
        `;
        const input = { id: toGid("Customer", args.customerId) };
        if (args.firstName !== undefined) input.firstName = args.firstName;
        if (args.lastName !== undefined) input.lastName = args.lastName;
        if (args.email !== undefined) input.email = args.email;
        if (args.phone !== undefined) input.phone = args.phone;
        if (args.note !== undefined) input.note = args.note;
        if (args.tags !== undefined) input.tags = args.tags;
        const data = await shopifyGql(mutation, { input });
        assertNoUserErrors(data.customerUpdate);
        return ok(data.customerUpdate.customer);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // NOTE: no customer-address-create tool on purpose. Adding a profile address does
  // not change where an existing order ships — the flow customers actually ask for
  // is shopify_update_order_shipping_address (orders.js).

  // 4. Update a customer address (WRITE)
  server.tool(
    "shopify_update_customer_address",
    "Update an existing customer PROFILE address (WRITE). This does NOT change where an " +
      "existing order ships — use shopify_update_order_shipping_address for that.",
    {
      customerId: z.string().describe("Customer GID or bare numeric id."),
      addressId: z.string().describe("Address GID — pass through verbatim, do not hand-construct."),
      address: z
        .object({
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          provinceCode: z
            .string()
            .optional()
            .describe('Province/state code, e.g. "CA". (province by name is deprecated).'),
          countryCode: z
            .string()
            .optional()
            .describe('ISO country code, e.g. "US". (country by name is deprecated).'),
          zip: z.string().optional(),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
        })
        .describe("Address fields to update."),
      setAsDefault: z.boolean().optional().describe("Set this address as the customer's default."),
    },
    async (args) => {
      try {
        const mutation = `
          mutation UpdateCustomerAddress($customerId: ID!, $addressId: ID!, $address: MailingAddressInput!, $setAsDefault: Boolean) {
            customerAddressUpdate(customerId: $customerId, addressId: $addressId, address: $address, setAsDefault: $setAsDefault) {
              address { id address1 city provinceCode countryCode zip }
              userErrors { field message }
            }
          }
        `;
        // TODO(HAY-219 §8): verify address GIDs are passed through verbatim (do NOT hand-construct addressId) against a real dev store.
        const variables = {
          customerId: toGid("Customer", args.customerId),
          addressId: args.addressId,
          address: args.address,
          setAsDefault: args.setAsDefault,
        };
        const data = await shopifyGql(mutation, variables);
        assertNoUserErrors(data.customerAddressUpdate);
        return ok(data.customerAddressUpdate.address);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCustomerTools };

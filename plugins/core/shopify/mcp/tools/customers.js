// tools/customers.js — Shopify Admin GraphQL MCP tools for customers (API 2026-04)
// Read side uses defaultEmailAddress/defaultPhoneNumber (top-level email/phone are
// deprecated on Customer in 2026-04).

const { z } = require("zod");
const { shopifyGql } = require("../lib/client");
const { ok, fail, unwrapConnection, pageInfo, toGid, assertNoUserErrors } = require("../lib/format");

function registerCustomerTools(server) {
  // 1. Find customers by email
  server.tool(
    "shopify_find_customer_by_email",
    "Find customers matching an email address. Returns a list with pagination.",
    {
      email: z.string().describe("Email address to search for."),
      first: z.number().int().optional().describe("Max number of customers to return (default 10)."),
    },
    async (args) => {
      try {
        const query = `
          query FindCustomerByEmail($first: Int!, $query: String!) {
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
          query: `email:"${args.email}"`,
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
    }
  );

  // 2. Get a single customer by email or phone identifier
  server.tool(
    "shopify_get_customer_by_identifier",
    "Get a single customer by a unique identifier (email address or E.164 phone number).",
    {
      emailAddress: z.string().optional().describe("Email address identifier."),
      phoneNumber: z.string().optional().describe("Phone number identifier in E.164 format."),
    },
    async (args) => {
      try {
        const query = `
          query CustomerByIdentifier($identifier: CustomerIdentifierInput!) {
            customerByIdentifier(identifier: $identifier) {
              id
              firstName
              lastName
              defaultEmailAddress { emailAddress }
              defaultPhoneNumber { phoneNumber }
              numberOfOrders
            }
          }
        `;
        const identifier = {};
        if (args.emailAddress) identifier.emailAddress = args.emailAddress;
        if (args.phoneNumber) identifier.phoneNumber = args.phoneNumber;
        const data = await shopifyGql(query, { identifier });
        return ok(data.customerByIdentifier);
      } catch (err) {
        return fail(err);
      }
    }
  );

  // 3. Get a customer by id (full detail)
  server.tool(
    "shopify_get_customer",
    "Get full details for a customer by id (accepts a GID or bare numeric id).",
    {
      customerId: z.string().describe("Customer GID or bare numeric id."),
    },
    async (args) => {
      try {
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
                province
                provinceCode
                country
                countryCode
                zip
                firstName
                lastName
                phone
                company
              }
            }
          }
        `; // TODO(HAY-219 §8): verify defaultEmailAddress.marketingState exists in 2026-04 against a real dev store.
        const data = await shopifyGql(query, { id: toGid("Customer", args.customerId) });
        return ok(data.customer);
      } catch (err) {
        return fail(err);
      }
    }
  );

  // 4. Update a customer (WRITE)
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
    }
  );

  // 5. Create a customer address (WRITE)
  server.tool(
    "shopify_create_customer_address",
    "Create a new address for a customer (WRITE).",
    {
      customerId: z.string().describe("Customer GID or bare numeric id."),
      address: z
        .object({
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          province: z.string().optional(),
          provinceCode: z.string().optional(),
          country: z.string().optional(),
          countryCode: z.string().optional(),
          zip: z.string().optional(),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
        })
        .describe("Address fields."),
      setAsDefault: z.boolean().optional().describe("Set this address as the customer's default."),
    },
    async (args) => {
      try {
        const mutation = `
          mutation CreateCustomerAddress($customerId: ID!, $address: MailingAddressInput!, $setAsDefault: Boolean) {
            customerAddressCreate(customerId: $customerId, address: $address, setAsDefault: $setAsDefault) {
              address { id address1 city province country zip }
              userErrors { field message }
            }
          }
        `;
        const variables = {
          customerId: toGid("Customer", args.customerId),
          address: args.address,
          setAsDefault: args.setAsDefault,
        };
        const data = await shopifyGql(mutation, variables);
        assertNoUserErrors(data.customerAddressCreate);
        return ok(data.customerAddressCreate.address);
      } catch (err) {
        return fail(err);
      }
    }
  );

  // 6. Update a customer address (WRITE)
  server.tool(
    "shopify_update_customer_address",
    "Update an existing customer address (WRITE).",
    {
      customerId: z.string().describe("Customer GID or bare numeric id."),
      addressId: z.string().describe("Address GID — pass through verbatim, do not hand-construct."),
      address: z
        .object({
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          province: z.string().optional(),
          provinceCode: z.string().optional(),
          country: z.string().optional(),
          countryCode: z.string().optional(),
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
              address { id address1 city province country zip }
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
    }
  );
}

module.exports = { registerCustomerTools };

/**
 * Customers: matched by email. New ones get `customerCreate` with their address; existing ones
 * get their name, locale and tags refreshed (addresses are left alone so re-runs don't stack them).
 */
import { DEMO_TAG, log } from "../lib/data";
import type { Address, Customer } from "../lib/types";
import { assertNoUserErrors, type Shopify } from "./client";

/** MailingAddressInput, shared with orderCreate's shipping/billing address. */
export function mailingAddress(address: Address): Record<string, unknown> {
  return {
    firstName: address.firstName,
    lastName: address.lastName,
    address1: address.address1,
    address2: address.address2 ?? null,
    city: address.city,
    provinceCode: address.provinceCode ?? null,
    zip: address.zip,
    countryCode: address.country,
    phone: address.phone ?? null,
  };
}

export function customerInput(customer: Customer, existingId?: string): Record<string, unknown> {
  const base = {
    firstName: customer.firstName,
    lastName: customer.lastName,
    locale: customer.locale,
    tags: [DEMO_TAG],
  };
  // No top-level phone: Shopify validates it strictly and the fake 555 numbers can fail.
  if (existingId) return { id: existingId, ...base };
  return { ...base, email: customer.email, addresses: [mailingAddress(customer.address)] };
}

export async function findCustomerId(shop: Shopify, email: string): Promise<string | undefined> {
  if (shop.dryRun) return undefined;
  const data = await shop.query<{ customers: { nodes: { id: string; email: string | null }[] } }>(
    `query FindCustomer($query: String!) { customers(first: 1, query: $query) { nodes { id email } } }`,
    { query: `email:"${email}"` },
  );
  return data.customers.nodes[0]?.id;
}

const CUSTOMER_CREATE = `
  mutation CustomerCreate($input: CustomerInput!) {
    customerCreate(input: $input) { customer { id } userErrors { field message } }
  }
`;

const CUSTOMER_UPDATE = `
  mutation CustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) { customer { id } userErrors { field message } }
  }
`;

/** Creates or updates every customer. Returns customer key → customer id. */
export async function seedCustomers(
  shop: Shopify,
  customers: Customer[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const customer of customers) {
    const existingId = await findCustomerId(shop, customer.email);
    const operation = existingId ? "customerUpdate" : "customerCreate";
    type Payload = { customer: { id: string } | null; userErrors: [] };
    const data = await shop.mutate<Record<string, Payload>>(
      existingId ? CUSTOMER_UPDATE : CUSTOMER_CREATE,
      { input: customerInput(customer, existingId) },
      {
        [operation]: {
          customer: { id: `gid://shopify/Customer/dry-run-${customer.key}` },
          userErrors: [],
        },
      },
    );
    assertNoUserErrors(`${operation} ${customer.email}`, data[operation]);
    ids[customer.key] = data[operation].customer?.id ?? (existingId as string);
    log(`${existingId ? "Updated" : "Created"} customer ${customer.email}`);
  }
  return ids;
}

/** Customer key → id for `--only orders` runs. */
export async function findCustomerIds(
  shop: Shopify,
  customers: Customer[],
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const customer of customers) {
    const id = shop.dryRun
      ? `gid://shopify/Customer/dry-run-${customer.key}`
      : await findCustomerId(shop, customer.email);
    if (!id)
      throw new Error(
        `Customer ${customer.email} is not in the store. Run without --only orders first.`,
      );
    ids[customer.key] = id;
  }
  return ids;
}

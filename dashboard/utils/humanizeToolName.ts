/**
 * Converts machine-formatted tool/field names to human-readable labels.
 *
 * @example humanizeToolName("send-email") // "Send Email"
 * @example humanizeToolName("list_customers") // "List Customers"
 * @example humanizeToolName("create_payment_intent") // "Create Payment Intent"
 * @example humanizeToolName("hubspot_create_contact") // "Hubspot Create Contact"
 */
export function humanizeToolName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

import type { FormResponse, FormSchema } from "./types.js";

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function renderFormResponseAsText(schema: FormSchema, response: FormResponse): string {
  const lines: string[] = [];
  if (schema.title) lines.push(schema.title, "");
  for (const field of schema.fields) {
    const raw = response[field.name];
    let display = formatValue(raw);
    if (field.type === "select" && raw != null) {
      const opt = field.options?.find((o) => o.value === raw);
      if (opt) display = opt.label;
    }
    lines.push(`${field.label}: ${display}`);
  }
  return lines.join("\n");
}

export function extractCustomerFields(
  schema: FormSchema,
  response: FormResponse,
): { name?: string; email?: string; phone?: string } {
  const out: { name?: string; email?: string; phone?: string } = {};
  for (const field of schema.fields) {
    if (!field.mapToCustomer) continue;
    const value = response[field.name];
    if (typeof value !== "string" || value.length === 0) continue;
    out[field.mapToCustomer] = value;
  }
  return out;
}

export function findMissingRequiredFields(
  schema: FormSchema,
  context: Record<string, unknown> | null | undefined,
): string[] {
  const ctx = context ?? {};
  const missing: string[] = [];
  for (const field of schema.fields) {
    if (!field.required) continue;
    const value = ctx[field.name];
    if (value === undefined || value === null || value === "") {
      missing.push(field.name);
    }
  }
  return missing;
}

import { z, ZodTypeAny } from "zod";

import type { FormField, FormSchema, FormResponse } from "./types.js";

function buildFieldValidator(field: FormField): ZodTypeAny {
  let validator: ZodTypeAny;

  switch (field.type) {
    case "email": {
      const base = z.string().email("Must be a valid email");
      validator = field.validation?.pattern
        ? base.regex(new RegExp(field.validation.pattern))
        : base;
      break;
    }
    case "phone": {
      const base = z.string().min(1);
      validator = field.validation?.pattern
        ? base.regex(new RegExp(field.validation.pattern))
        : base;
      break;
    }
    case "text":
    case "textarea": {
      let base = z.string();
      if (field.validation?.min !== undefined) base = base.min(field.validation.min);
      if (field.validation?.max !== undefined) base = base.max(field.validation.max);
      if (field.validation?.pattern) base = base.regex(new RegExp(field.validation.pattern));
      validator = base;
      break;
    }
    case "number": {
      let base = z.number();
      if (field.validation?.min !== undefined) base = base.min(field.validation.min);
      if (field.validation?.max !== undefined) base = base.max(field.validation.max);
      validator = base;
      break;
    }
    case "date": {
      validator = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");
      break;
    }
    case "select": {
      const allowed = (field.options ?? []).map((o) => o.value);
      if (allowed.length === 0) {
        validator = z.string();
      } else {
        validator = z.enum(allowed as [string, ...string[]]);
      }
      break;
    }
    case "checkbox": {
      validator = z.boolean();
      break;
    }
  }

  if (!field.required) {
    validator = validator.optional().nullable();
  }

  return validator;
}

export function buildResponseValidator(
  schema: FormSchema,
): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of schema.fields) {
    shape[field.name] = buildFieldValidator(field);
  }
  return z.object(shape);
}

export interface ValidatedResponse {
  success: true;
  data: FormResponse;
}

export interface InvalidResponse {
  success: false;
  errors: Record<string, string>;
}

export function validateResponse(
  schema: FormSchema,
  response: unknown,
): ValidatedResponse | InvalidResponse {
  const validator = buildResponseValidator(schema);
  const result = validator.safeParse(response);
  if (result.success) {
    return { success: true, data: result.data as FormResponse };
  }
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (path && !errors[path]) {
      errors[path] = issue.message;
    }
  }
  return { success: false, errors };
}

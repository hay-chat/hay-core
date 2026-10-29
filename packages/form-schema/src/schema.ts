import { z } from "zod";

const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/i;

export const formFieldOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

export const formFieldValidationSchema = z.object({
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const formFieldTypeSchema = z.enum([
  "text",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "checkbox",
  "textarea",
]);

export const customerFieldMappingSchema = z.enum(["name", "email", "phone"]);

export const formFieldSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(
        FIELD_NAME_PATTERN,
        "Field name must start with a letter and contain only letters, numbers, and underscores",
      ),
    label: z.string().min(1),
    type: formFieldTypeSchema,
    required: z.boolean().optional(),
    placeholder: z.string().optional(),
    options: z.array(formFieldOptionSchema).optional(),
    validation: formFieldValidationSchema.optional(),
    mapToCustomer: customerFieldMappingSchema.optional(),
  })
  .refine((field) => field.type !== "select" || (field.options && field.options.length > 0), {
    message: "Select fields must define at least one option",
    path: ["options"],
  });

export const formSchemaSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    submitLabel: z.string().optional(),
    fields: z.array(formFieldSchema).min(1, "Form must have at least one field"),
  })
  .refine(
    (form) => {
      const names = form.fields.map((f) => f.name);
      return new Set(names).size === names.length;
    },
    { message: "Field names must be unique", path: ["fields"] },
  );

export const formStatusSchema = z.enum(["PENDING", "SUBMITTED", "SKIPPED"]);

export const formResponseValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const formResponseSchema = z.record(formResponseValueSchema);

export const formMessageMetadataSchema = z.object({
  ui: z.object({
    kind: z.literal("form"),
    schema: formSchemaSchema,
    status: formStatusSchema,
    response: formResponseSchema.optional(),
    submittedAt: z.string().optional(),
  }),
});
